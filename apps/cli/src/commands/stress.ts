import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { createFredClient, assembleStressIndex } from '@firma/fred';
import { readConfig } from '../config.ts';

const labelColor = (label: string | null): ((s: string) => string) => {
  if (label === 'Low')      return pc.green;
  if (label === 'Moderate') return pc.cyan;
  if (label === 'Elevated') return pc.yellow;
  if (label === 'Severe')   return pc.red;
  if (label === 'Critical') return (s: string) => pc.bold(pc.red(s));
  return pc.dim;
};

export const showStressCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const apiKey = readConfig()?.fred_api_key;
  if (!apiKey) {
    const msg = 'FRED API key not set. Run: firma config set fred-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  let data;
  if (json) {
    data = await assembleStressIndex(createFredClient(apiKey));
  } else {
    const s = spinner();
    s.start('Computing Economic Stress Index...');
    try {
      data = await assembleStressIndex(createFredClient(apiKey));
      s.stop('Done');
    } catch (err) {
      s.stop('Failed');
      log.error(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (data.total_score == null) {
    log.warn('No data available for any stress component.');
    return;
  }

  const color = labelColor(data.label);
  const headline = `${pc.bold(color(`${data.total_score} / 100`))}  ${color(`(${data.label})`)}`;

  const COL = { LABEL: 28, RAW: 12, SCORE: 10, WEIGHT: 8 };
  const header = [
    pc.dim('COMPONENT'.padEnd(COL.LABEL)),
    pc.dim('VALUE'.padEnd(COL.RAW)),
    pc.dim('SCORE'.padEnd(COL.SCORE)),
    pc.dim('WEIGHT'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.LABEL + COL.RAW + COL.SCORE + COL.WEIGHT + 6));

  const rows = data.components.map(c => {
    const raw = c.raw_value == null ? pc.dim('─')
      : c.id === 'job_claims' ? `${Math.round(c.raw_value / 1000)}k`
      : c.raw_value.toFixed(2);
    const score = c.score == null ? pc.dim('─') : Math.round(c.score).toString();
    return [
      c.label.padEnd(COL.LABEL),
      raw.padEnd(COL.RAW),
      score.padEnd(COL.SCORE),
      pc.dim(`${(c.weight * 100).toFixed(1)}%`),
    ].join('  ');
  });

  const body = [
    `${pc.dim('Stress Score:')}  ${headline}`,
    '',
    header,
    divider,
    ...rows,
    '',
    pc.dim('Scale: <20 Low · 20–40 Moderate · 40–60 Elevated · 60–80 Severe · ≥80 Critical'),
    pc.dim('Source: FRED  ·  Not investment advice'),
  ].join('\n');

  note(body, 'Economic Stress Index');
};
