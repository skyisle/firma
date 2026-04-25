import { readFileSync } from 'fs';
import { basename } from 'path';
import { parse } from 'csv-parse/sync';
import { confirm, log, spinner, note } from '@clack/prompts';
import pc from 'picocolors';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

// ── Types ──────────────────────────────────────────────────────────────────────

type CsvRow = Record<string, string>;

type ImportType =
  | 'transactions'
  | 'balance'
  | 'flow'
  | 'mixed'
  | 'notion-balance'
  | 'notion-flow'
  | 'notion-trades';

type PreparedFile = {
  file: string;
  type: ImportType;
  label: string;
  rawCount: number;
  importCount: number;
  execute: (token: string) => Promise<void>;
};

// ── CSV parsing ────────────────────────────────────────────────────────────────

const readCsv = (file: string): CsvRow[] => {
  const content = readFileSync(file, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
};

const detectType = (rows: CsvRow[]): ImportType => {
  if (!rows.length) throw new Error('CSV is empty');
  const headers = Object.keys(rows[0]);

  if (headers.includes('ticker')) return 'transactions';
  if (headers.includes('티커')) return 'notion-trades';
  if (headers.includes('현금흐름표')) return 'notion-flow';
  if (headers.includes('재무상태표(자산)')) return 'notion-balance';

  const types = new Set(rows.map(r => r.type));
  const isBalance = [...types].every(t => ['asset', 'liability'].includes(t));
  const isFlow = [...types].every(t => ['income', 'expense'].includes(t));

  if (isBalance) return 'balance';
  if (isFlow) return 'flow';
  return 'mixed';
};

const TYPE_LABEL: Record<ImportType, string> = {
  'transactions':   'Transactions',
  'balance':        'Balance sheet',
  'flow':           'Cash flow',
  'mixed':          'Mixed (unsupported)',
  'notion-balance': 'Notion balance sheet',
  'notion-flow':    'Notion cash flow',
  'notion-trades':  'Notion trade history',
};

// ── Standard validators ────────────────────────────────────────────────────────

const parseTransactionRow = (row: CsvRow, i: number) => {
  const shares = parseFloat(row.shares);
  const price = parseFloat(row.price);
  if (!row.date) throw new Error(`Row ${i + 1}: missing date`);
  if (!row.ticker) throw new Error(`Row ${i + 1}: missing ticker`);
  if (!['buy', 'sell'].includes(row.type)) throw new Error(`Row ${i + 1}: type must be buy or sell`);
  if (isNaN(shares) || shares <= 0) throw new Error(`Row ${i + 1}: invalid shares`);
  if (isNaN(price) || price <= 0) throw new Error(`Row ${i + 1}: invalid price`);
  return {
    date: row.date,
    ticker: row.ticker.toUpperCase(),
    type: row.type as 'buy' | 'sell',
    shares,
    price,
    currency: row.currency || 'USD',
  };
};

const parseLedgerRow = (row: CsvRow, i: number) => {
  const amount = parseInt(row.amount?.replace(/,/g, ''), 10);
  if (!row.period || !/^\d{4}-\d{2}$/.test(row.period)) throw new Error(`Row ${i + 1}: invalid period (YYYY-MM)`);
  if (!row.type) throw new Error(`Row ${i + 1}: missing type`);
  if (!row.sub_type) throw new Error(`Row ${i + 1}: missing sub_type`);
  if (!row.category) throw new Error(`Row ${i + 1}: missing category`);
  if (isNaN(amount)) throw new Error(`Row ${i + 1}: invalid amount`);
  return {
    period: row.period,
    date: row.date || `${row.period}-28`,
    type: row.type,
    sub_type: row.sub_type,
    category: row.category,
    amount,
    memo: row.memo || undefined,
  };
};

// Notion sometimes appends " (1)" to duplicate page titles — strip to get clean YYYY-MM
const normalizeNotionPeriod = (id: string): string =>
  (id.match(/^\d{4}-\d{2}/) ?? [])[0] ?? id;

// ── Notion balance transformer ─────────────────────────────────────────────────

const NOTION_BALANCE_TYPE: Record<string, string> = {
  '자산': 'asset',
  '부채': 'liability',
};

const NOTION_BALANCE_SUBTYPE: Record<string, string> = {
  '현금 및 예금': 'cash',
  '투자자산':    'investment',
  '기타 자산':   'other',
  '단기부채':    'short_term',
  '장기부채':    'long_term',
};

const NOTION_BALANCE_CATEGORY: Record<string, string> = {
  '현금':    'cash',
  '예적금':  'savings',
  '주택청약': 'housing_sub',
  '국내주식': 'domestic_stock',
  '해외주식': 'overseas_stock',
  '부동산':  'real_estate',
  '연금':    'pension',
  '자동차':  'vehicle',
  '보증금':  'deposit',
  '신용카드': 'credit_card',
  '대출':    'loan',
};

const NOTION_BALANCE_OTHER: Record<string, string> = {
  '현금 및 예금': 'cash_other',
  '기타 자산':   'asset_other',
  '단기부채':    'short_term_other',
  '장기부채':    'long_term_other',
};

const transformNotionBalanceRows = (rows: CsvRow[]): CsvRow[] =>
  rows
    .filter(r => r['대카테고리'] && r['중카테고리'] && r['카테고리'])
    .map((r, i) => {
      const type = NOTION_BALANCE_TYPE[r['대카테고리']];
      const subType = NOTION_BALANCE_SUBTYPE[r['중카테고리']];
      const category =
        r['카테고리'] === '기타'
          ? NOTION_BALANCE_OTHER[r['중카테고리']]
          : NOTION_BALANCE_CATEGORY[r['카테고리']];

      if (!type) throw new Error(`Row ${i + 1}: unknown 대카테고리 "${r['대카테고리']}"`);
      if (!subType) throw new Error(`Row ${i + 1}: unknown 중카테고리 "${r['중카테고리']}"`);
      if (!category) throw new Error(`Row ${i + 1}: unknown 카테고리 "${r['카테고리']}" (under ${r['중카테고리']})`);

      return {
        period: normalizeNotionPeriod(r['ID']),
        date: r['기준일'].replace(/\//g, '-'),
        type,
        sub_type: subType,
        category,
        amount: r['금액'].replace(/[₩,\s]/g, '') || '0',
        memo: r['메모'] || '',
      };
    });

// ── Notion cash flow transformer ───────────────────────────────────────────────

const NOTION_FLOW_TYPE: Record<string, string> = {
  '수익': 'income',
  '지출': 'expense',
};

const NOTION_FLOW_SUBTYPE: Record<string, string> = {
  '근로':  'employment',
  '투자':  'investment',
  '고정비': 'fixed',
  '소비':  'consumption',
  '주거':  'housing',
  '부채':  'debt',
  '기타':  'other',
};

const NOTION_FLOW_CATEGORY: Record<string, string> = {
  '급여':   'salary',
  '사업':   'business',
  '배당금':  'dividends',
  '이자':   'interest',
  '공과금':  'utilities',
  '보험':   'insurance',
  '통신비':  'phone',
  '개인소비': 'personal',
  '관리비':  'maintenance',
  '집세':   'rent',
  '상환':   'loan_repayment',
  '대출':   'income_other',
};

const transformNotionFlowRows = (rows: CsvRow[]): CsvRow[] =>
  rows
    .filter(r => r['대카테고리'])
    .map((r, i) => {
      const type = NOTION_FLOW_TYPE[r['대카테고리']];
      if (!type) throw new Error(`Row ${i + 1}: unknown 대카테고리 "${r['대카테고리']}"`);

      const subType = NOTION_FLOW_SUBTYPE[r['중카테고리']] ?? 'other';
      const fallback = type === 'income' ? 'income_other' : 'expense_other';
      const category =
        !r['카테고리'] || r['카테고리'] === '기타'
          ? fallback
          : (NOTION_FLOW_CATEGORY[r['카테고리']] ?? fallback);

      return {
        period: normalizeNotionPeriod(r['ID']),
        date: r['기준일'].replace(/\//g, '-'),
        type,
        sub_type: subType,
        category,
        amount: r['금액'].replace(/[₩,\s]/g, '') || '0',
        memo: r['메모'] || '',
      };
    });

// ── Notion tradebook transformer ───────────────────────────────────────────────

const parseKoreanDate = (s: string): string => {
  const m = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) throw new Error(`Cannot parse date: "${s}"`);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

const extractTicker = (s: string): string =>
  s.replace(/\s*\(https?:\/\/[^)]+\)/, '').replace(/\s+\d+$/, '').trim();

const parseNotionAmount = (s: string): number =>
  Math.abs(parseFloat(s.replace(/[^0-9.-]/g, '')) || 0);

const NOTION_TRADE_TYPE: Record<string, string> = {
  '매수': 'buy',
  '매도': 'sell',
  '입고': 'deposit',
  '배당': 'dividend',
  '세금': 'tax',
};

const transformNotionTradeRows = (rows: CsvRow[]) =>
  rows
    .filter(r => r['상태'] === '완료' && r['카테고리'] in NOTION_TRADE_TYPE)
    .map((r, i) => {
      const type = NOTION_TRADE_TYPE[r['카테고리']];
      const ticker = extractTicker(r['티커']).toUpperCase();
      const date = parseKoreanDate(r['날짜']);
      const currency = r['거래통화'] || 'USD';
      const totalAmount = parseNotionAmount(r['금액']);

      // buy / sell: price per share calculated from total amount
      if (type === 'buy' || type === 'sell') {
        const shares = parseInt(r['거래수량'], 10);
        if (isNaN(shares) || shares <= 0) throw new Error(`Row ${i + 1}: invalid 거래수량`);
        const price = totalAmount / shares;
        if (price <= 0) throw new Error(`Row ${i + 1}: cannot calculate price`);
        return { date, ticker, type, shares, price, currency };
      }

      // deposit: shares transferred in, no purchase price
      if (type === 'deposit') {
        const shares = parseInt(r['거래수량'], 10);
        if (isNaN(shares) || shares <= 0) throw new Error(`Row ${i + 1}: invalid 거래수량`);
        return { date, ticker, type, shares, price: 0, currency };
      }

      // dividend / tax: no shares, total amount stored in price field
      return { date, ticker, type, shares: 0, price: totalAmount, currency };
    });

// ── Import runners ─────────────────────────────────────────────────────────────

const runImportTransactions = async (rows: CsvRow[], token: string) => {
  const parsed = rows.map((r, i) => parseTransactionRow(r, i));
  const s = spinner();
  s.start(`Importing ${parsed.length} transactions...`);
  for (const tx of parsed) {
    await apiFetch('/api/transactions', { method: 'POST', token, body: tx });
  }
  s.stop(`Imported ${parsed.length} transactions`);
};

const runImportLedger = async (rows: CsvRow[], token: string, type: 'balance' | 'flow') => {
  const parsed = rows.map((r, i) => parseLedgerRow(r, i));

  // Merge duplicates by (period, type, sub_type, category) — sum amounts
  const dedupMap = new Map<string, typeof parsed[number]>();
  for (const row of parsed) {
    const key = `${row.period}|${row.type}|${row.sub_type}|${row.category}`;
    const existing = dedupMap.get(key);
    dedupMap.set(key, existing ? { ...existing, amount: existing.amount + row.amount } : row);
  }
  const deduped = [...dedupMap.values()];

  const byPeriod = new Map<string, typeof deduped>();
  for (const row of deduped) {
    const group = byPeriod.get(row.period) ?? [];
    group.push(row);
    byPeriod.set(row.period, group);
  }

  const s = spinner();
  s.start(`Importing ${deduped.length} entries across ${byPeriod.size} period(s)...`);
  for (const [period, entries] of byPeriod) {
    await apiFetch(`/api/${type}`, {
      method: 'POST',
      token,
      body: { period, date: entries[0].date, entries },
    });
  }
  s.stop(`Imported ${deduped.length} entries`);
};

const runImportNotionTrades = async (rows: CsvRow[], token: string) => {
  const parsed = transformNotionTradeRows(rows);
  const s = spinner();
  s.start(`Importing ${parsed.length} transactions...`);
  for (const tx of parsed) {
    await apiFetch('/api/transactions', { method: 'POST', token, body: tx });
  }
  s.stop(`Imported ${parsed.length} transactions`);
};

// ── File preparation ───────────────────────────────────────────────────────────

const prepareFile = (file: string): PreparedFile => {
  const rows = readCsv(file);
  const type = detectType(rows);

  if (type === 'mixed') throw new Error(`${basename(file)}: mixed types — split into separate files`);

  const importCount = type === 'notion-trades'
    ? rows.filter(r => r['상태'] === '완료' && r['카테고리'] in NOTION_TRADE_TYPE).length
    : type === 'notion-balance' ? rows.filter(r => r['대카테고리'] && r['중카테고리'] && r['카테고리']).length
    : type === 'notion-flow'    ? rows.filter(r => r['대카테고리']).length
    : rows.length;

  const execute = async (token: string) => {
    if (type === 'notion-balance') {
      await runImportLedger(transformNotionBalanceRows(rows), token, 'balance');
    } else if (type === 'notion-flow') {
      await runImportLedger(transformNotionFlowRows(rows), token, 'flow');
    } else if (type === 'notion-trades') {
      await runImportNotionTrades(rows, token);
    } else if (type === 'transactions') {
      await runImportTransactions(rows, token);
    } else {
      await runImportLedger(rows, token, type as 'balance' | 'flow');
    }
  };

  return { file, type, label: TYPE_LABEL[type], rawCount: rows.length, importCount, execute };
};

// ── Preview ────────────────────────────────────────────────────────────────────

const previewRows = (rows: CsvRow[], limit = 5) => {
  const headers = Object.keys(rows[0]);
  const preview = rows.slice(0, limit).map(r =>
    headers.map(h => String(r[h] ?? '').slice(0, 15).padEnd(15)).join('  ')
  );
  const header = headers.map(h => pc.dim(h.padEnd(15))).join('  ');
  note(
    `${header}\n${preview.join('\n')}${rows.length > limit ? pc.dim(`\n  ... and ${rows.length - limit} more rows`) : ''}`,
    `Preview  (${rows.length} rows)`
  );
};

// ── Entry point ────────────────────────────────────────────────────────────────

export const importCommand = async (files: string[], opts: { yes?: boolean } = {}) => {
  const { token } = requireAuth();

  // ── Single file: show preview, individual confirm ───────────────────────────
  if (files.length === 1) {
    const file = files[0];
    let prepared: PreparedFile;
    try {
      prepared = prepareFile(file);
    } catch (err) {
      log.error(err instanceof Error ? err.message : 'Failed to read file');
      process.exit(1);
    }

    log.info(`Detected type: ${pc.bold(prepared.label)}`);
    if (prepared.type === 'notion-trades') {
      if (prepared.rawCount > prepared.importCount)
        log.info(`${prepared.importCount} rows  (${prepared.rawCount - prepared.importCount} skipped: pending or unknown)`);
    }
    previewRows(readCsv(file));

    const question = prepared.type === 'notion-trades'
      ? `Import ${prepared.importCount} transactions?`
      : `Import ${prepared.importCount} rows as ${pc.bold(prepared.label)}?`;

    if (!opts.yes) {
      const ok = await confirm({ message: question });
      if (!ok || typeof ok === 'symbol') { log.warn('Import cancelled'); process.exit(0); }
    }

    try {
      await prepared.execute(token);
      log.success('Import complete');
    } catch (err) {
      log.error(err instanceof Error ? err.message : 'Import failed');
      process.exit(1);
    }
    return;
  }

  // ── Multiple files: show summary, single confirm ────────────────────────────
  const prepared: PreparedFile[] = [];
  for (const file of files) {
    try {
      prepared.push(prepareFile(file));
    } catch (err) {
      log.error(err instanceof Error ? err.message : `Failed to read ${basename(file)}`);
      process.exit(1);
    }
  }

  const col1 = Math.max(10, ...prepared.map(p => basename(p.file).length));
  const col2 = Math.max(8, ...prepared.map(p => p.label.length));

  const rows = prepared.map(p => {
    const skipped = p.rawCount - p.importCount;
    const countStr = skipped > 0
      ? `${p.importCount}  ${pc.dim(`(${skipped} skipped)`)}`
      : String(p.importCount);
    return `${basename(p.file).padEnd(col1)}  ${p.label.padEnd(col2)}  ${countStr}`;
  });

  const header = `${pc.dim('File'.padEnd(col1))}  ${pc.dim('Type'.padEnd(col2))}  ${pc.dim('Rows')}`;
  const total = prepared.reduce((s, p) => s + p.importCount, 0);

  note(
    [header, pc.dim('─'.repeat(col1 + col2 + 20)), ...rows].join('\n'),
    `Bulk import  (${prepared.length} files, ${total} total rows)`
  );

  if (!opts.yes) {
    const ok = await confirm({ message: `Import all ${prepared.length} files?` });
    if (!ok || typeof ok === 'symbol') { log.warn('Import cancelled'); process.exit(0); }
  }

  for (const p of prepared) {
    log.step(`${basename(p.file)}  ${pc.dim(p.label)}`);
    try {
      await p.execute(token);
    } catch (err) {
      log.error(err instanceof Error ? err.message : `Failed to import ${basename(p.file)}`);
      process.exit(1);
    }
  }

  log.success(`All ${prepared.length} files imported`);
};
