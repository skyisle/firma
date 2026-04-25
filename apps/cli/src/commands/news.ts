import { log, spinner, note } from '@clack/prompts';
import pc from 'picocolors';
import { createFinnhubClient } from '@firma/finnhub';
import { readConfig } from '../config.ts';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const relativeTime = (unixSec: number): string => {
  const diffH = Math.floor((Date.now() - unixSec * 1000) / 3_600_000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
};

export const newsCommand = async (
  ticker: string,
  { json = false, days = 7, limit = 10 } = {},
) => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) {
    const msg = 'Finnhub API key not set. Run: firma config set finnhub-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  const sym = ticker.toUpperCase();
  const to   = toDateStr(new Date());
  const from = toDateStr(new Date(Date.now() - days * 86_400_000));

  const s = json ? null : spinner();
  s?.start(`Fetching news for ${sym}...`);

  try {
    const client = createFinnhubClient(apiKey);
    const all   = await client.getCompanyNews(sym, from, to);
    const items = all.slice(0, limit);

    s?.stop(`${items.length} article${items.length !== 1 ? 's' : ''}`);

    if (json) {
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
      return;
    }

    if (items.length === 0) {
      log.warn(`No news for ${sym} in the last ${days} days.`);
      return;
    }

    const lines = items.map((item, i) => {
      const idx      = pc.dim(`${String(i + 1).padStart(2)}.`);
      const headline = pc.bold(item.headline);
      const meta     = pc.dim(`${item.source}  ·  ${relativeTime(item.datetime)}`);
      const summary  = item.summary.length > 130
        ? item.summary.slice(0, 127) + '...'
        : item.summary;
      return `${idx} ${headline}\n     ${pc.dim(summary)}\n     ${meta}\n     ${pc.cyan(item.url)}`;
    }).join('\n\n');

    note(lines, `News — ${sym} (last ${days}d)`);
  } catch (err) {
    s?.stop('Failed');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
  }
};
