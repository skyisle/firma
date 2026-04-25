import { log, spinner, note } from '@clack/prompts';
import pc from 'picocolors';
import { createFinnhubClient } from '@firma/finnhub';
import type { FinancialLineItem, FinancialPeriod } from '@firma/finnhub';
import { readConfig } from '../config.ts';

const find = (items: FinancialLineItem[], ...concepts: string[]): number | null => {
  for (const concept of concepts) {
    const hit = items.find(i => i.concept === concept);
    if (hit != null) return hit.value;
  }
  return null;
};

const fmtBig = (n: number | null): string => {
  if (n == null) return '─';
  const sign = n < 0 ? '-' : '';
  const abs  = Math.abs(n);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
};

const fmtEps = (n: number | null): string =>
  n == null ? '─' : `$${n.toFixed(2)}`;

const periodLabel = (p: FinancialPeriod): string =>
  p.quarter === 0 ? `FY ${p.year}` : `Q${p.quarter} ${p.year}`;

type ExtractedPeriod = {
  label:          string;
  form:           string;
  filedDate:      string;
  revenue:        number | null;
  grossProfit:    number | null;
  operatingIncome:number | null;
  netIncome:      number | null;
  epsDiluted:     number | null;
  operatingCF:    number | null;
  capex:          number | null;
  totalAssets:    number | null;
  cash:           number | null;
  totalDebt:      number | null;
};

const extractPeriod = (p: FinancialPeriod): ExtractedPeriod => {
  const ic = p.report?.ic ?? [];
  const cf = p.report?.cf ?? [];
  const bs = p.report?.bs ?? [];
  return {
    label:           periodLabel(p),
    form:            p.form,
    filedDate:       p.filedDate,
    revenue:         find(ic,
                       'us-gaap/Revenues',
                       'us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax',
                       'us-gaap/SalesRevenueNet',
                     ),
    grossProfit:     find(ic, 'us-gaap/GrossProfit'),
    operatingIncome: find(ic, 'us-gaap/OperatingIncomeLoss'),
    netIncome:       find(ic, 'us-gaap/NetIncomeLoss', 'us-gaap/ProfitLoss'),
    epsDiluted:      find(ic, 'us-gaap/EarningsPerShareDiluted', 'us-gaap/EarningsPerShareBasic'),
    operatingCF:     find(cf, 'us-gaap/NetCashProvidedByUsedInOperatingActivities'),
    capex:           find(cf, 'us-gaap/PaymentsToAcquirePropertyPlantAndEquipment'),
    totalAssets:     find(bs, 'us-gaap/Assets'),
    cash:            find(bs,
                       'us-gaap/CashAndCashEquivalentsAtCarryingValue',
                       'us-gaap/CashCashEquivalentsAndShortTermInvestments',
                     ),
    totalDebt:       find(bs, 'us-gaap/LongTermDebt', 'us-gaap/LongTermDebtNoncurrent'),
  };
};

export const financialsCommand = async (
  ticker: string,
  { json = false, annual = false, limit = 4 } = {},
) => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) {
    const msg = 'Finnhub API key not set. Run: firma config set finnhub-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  const sym  = ticker.toUpperCase();
  const freq = annual ? 'annual' : 'quarterly';

  const s = json ? null : spinner();
  s?.start(`Fetching ${freq} financials for ${sym}...`);

  try {
    const client   = createFinnhubClient(apiKey);
    const res      = await client.getFinancialsReported(sym, freq);
    const raw      = (res.data ?? []).slice(0, limit);

    s?.stop(`${raw.length} period${raw.length !== 1 ? 's' : ''}`);

    if (json) {
      process.stdout.write(JSON.stringify({
        symbol: sym,
        freq,
        periods: raw.map(p => ({ ...extractPeriod(p), raw: p.report })),
      }, null, 2) + '\n');
      return;
    }

    if (raw.length === 0) {
      log.warn(`No financials found for ${sym}. Note: requires Finnhub API access to SEC filings.`);
      return;
    }

    const periods = raw.map(extractPeriod);
    const LBL_W   = 16;
    const COL_W   = 13;

    const row = (label: string, values: string[]) =>
      pc.dim(label.padEnd(LBL_W)) + values.map(v => v.padEnd(COL_W)).join('');

    const divider = pc.dim('─'.repeat(LBL_W + periods.length * COL_W));
    const header  = ''.padEnd(LBL_W) + periods.map(p => pc.bold(p.label).padEnd(COL_W)).join('');

    const lines = [
      header,
      divider,
      row('Revenue',       periods.map(p => fmtBig(p.revenue))),
      row('Gross Profit',  periods.map(p => fmtBig(p.grossProfit))),
      row('Op Income',     periods.map(p => fmtBig(p.operatingIncome))),
      row('Net Income',    periods.map(p => fmtBig(p.netIncome))),
      row('EPS (diluted)', periods.map(p => fmtEps(p.epsDiluted))),
      divider,
      row('Op Cash Flow',  periods.map(p => fmtBig(p.operatingCF))),
      row('CapEx',         periods.map(p => p.capex != null ? fmtBig(-Math.abs(p.capex)) : '─')),
      divider,
      row('Total Assets',  periods.map(p => fmtBig(p.totalAssets))),
      row('Cash',          periods.map(p => fmtBig(p.cash))),
      row('Total Debt',    periods.map(p => fmtBig(p.totalDebt))),
    ].join('\n');

    const latest = periods[0];
    const footer = pc.dim(`\nLatest: ${latest.label} (${latest.form}, filed ${latest.filedDate})`);

    note(lines + footer, `Financials — ${sym} (${annual ? 'Annual' : 'Quarterly'})`);
  } catch (err) {
    s?.stop('Failed');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
  }
};
