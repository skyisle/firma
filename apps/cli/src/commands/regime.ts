import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { createFredClient, assembleRegime } from '@firma/fred';
import { readConfig } from '../config.ts';

const biasColor = (bias: string | null): ((s: string) => string) => {
  if (bias === 'Risk-on bias')  return pc.green;
  if (bias === 'Risk-off bias') return pc.red;
  if (bias === 'Mixed')         return pc.yellow;
  return pc.dim;
};

export const showRegimeCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const apiKey = readConfig()?.fred_api_key;
  if (!apiKey) {
    const msg = 'FRED API key not set. Run: firma config set fred-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  let data;
  if (json) {
    data = await assembleRegime(createFredClient(apiKey));
  } else {
    const s = spinner();
    s.start('Evaluating macro regime signals...');
    try {
      data = await assembleRegime(createFredClient(apiKey));
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

  const known = data.bullish_count + data.bearish_count;
  const color = biasColor(data.bias);
  const headline = data.bias
    ? `${color(pc.bold(data.bias))}  ${pc.dim(`(${data.bullish_count} of ${known} signals risk-on)`)}`
    : pc.dim('Insufficient data');

  const rows = data.signals.map(s => {
    const mark = s.bullish === true  ? pc.green('✓')
              : s.bullish === false ? pc.red('✗')
              : pc.dim('·');
    return `  ${mark}  ${s.detail}`;
  });

  const body = [
    `${pc.dim('Bias:')}  ${headline}`,
    '',
    ...rows,
    '',
    pc.dim('Each signal is a binary risk-on / risk-off heuristic over a single FRED series.'),
    pc.dim('≥70% bullish → Risk-on bias  ·  ≤40% → Risk-off bias  ·  otherwise Mixed'),
    pc.dim('Source: FRED  ·  Not investment advice'),
  ].join('\n');

  note(body, 'Macro Regime');
};
