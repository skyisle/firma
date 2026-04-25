import { cancel, isCancel, log, select, text } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import type { Transaction, NewTransaction } from '@firma/db';

const guard = <T>(value: T | symbol): T => {
  if (isCancel(value)) { cancel('Cancelled'); process.exit(0); }
  return value as T;
};

const validateDate = (val: string) => {
  if (!val.trim()) return 'Date is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return 'Use YYYY-MM-DD format';
  if (isNaN(new Date(val.trim()).getTime())) return 'Invalid date';
};

const validateNumber = (label: string, allowZero: boolean) => (val: string) => {
  if (!val.trim()) return `${label} is required`;
  const n = parseFloat(val);
  if (isNaN(n)) return 'Must be a number';
  if (allowZero ? n < 0 : n <= 0) return allowZero ? 'Must be ≥ 0' : 'Must be > 0';
};

const fmtTxn = (t: Transaction) => {
  const amount = t.shares * t.price;
  const detail = (t.type === 'dividend' || t.type === 'tax')
    ? `$${amount.toFixed(2)}`
    : `${t.shares} @ $${t.price.toFixed(2)} = $${amount.toFixed(2)}`;
  return `${pc.dim(t.date)}  ${pc.bold(t.ticker.padEnd(6))} ${t.type.padEnd(9)} ${detail}`;
};

const promptField = async (txn: Transaction): Promise<Partial<NewTransaction> | null> => {
  const allowZeroPrice = txn.type === 'deposit';

  const field = guard(await select({
    message: 'Edit which field?',
    options: [
      { value: 'date',   label: `Date     ${pc.dim('(' + txn.date + ')')}` },
      { value: 'shares', label: `Shares   ${pc.dim('(' + txn.shares + ')')}` },
      { value: 'price',  label: `Price    ${pc.dim('($' + txn.price.toFixed(2) + ')')}` },
      { value: 'memo',   label: `Memo     ${pc.dim('(' + (txn.memo ?? '—') + ')')}` },
      { value: '__done__', label: pc.dim('Done') },
    ],
  })) as string;

  if (field === '__done__') return null;

  if (field === 'date') {
    const v = (guard(await text({ message: 'New date', initialValue: txn.date, validate: validateDate })) as string).trim();
    return { date: v };
  }
  if (field === 'shares') {
    const v = guard(await text({
      message: 'New shares', initialValue: String(txn.shares), validate: validateNumber('Shares', false),
    })) as string;
    return { shares: parseFloat(v) };
  }
  if (field === 'price') {
    const v = guard(await text({
      message: 'New price', initialValue: String(txn.price), validate: validateNumber('Price', allowZeroPrice),
    })) as string;
    return { price: parseFloat(v) };
  }
  if (field === 'memo') {
    const v = guard(await text({ message: 'New memo', initialValue: txn.memo ?? '' })) as string;
    return { memo: v.trim() || null };
  }
  return null;
};

export const editCommand = async (idArg?: string) => {
  const repo = getRepository();

  let id: number;
  if (idArg) {
    id = Number(idArg);
    if (!Number.isInteger(id) || id <= 0) {
      log.error(`Invalid id: ${idArg}`);
      process.exit(1);
    }
  } else {
    const all = repo.transactions.getAll();
    if (all.length === 0) {
      log.warn('No transactions to edit.');
      return;
    }
    const recent = [...all].reverse().slice(0, 30);
    id = guard(await select({
      message: 'Select transaction to edit',
      options: recent.map(t => ({ value: t.id, label: fmtTxn(t) })),
    })) as number;
  }

  let txn = repo.transactions.getById(id);
  if (!txn) {
    log.error(`Transaction #${id} not found.`);
    process.exit(1);
  }

  log.message(fmtTxn(txn));

  while (true) {
    const update = await promptField(txn);
    if (!update) break;
    repo.transactions.update(id, update);
    txn = repo.transactions.getById(id)!;
    log.message(fmtTxn(txn));
  }

  log.success(`Updated transaction #${id}.`);
};
