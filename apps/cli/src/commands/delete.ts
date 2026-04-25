import { cancel, confirm, isCancel, log, select } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import type { Transaction } from '@firma/db';

const guard = <T>(value: T | symbol): T => {
  if (isCancel(value)) { cancel('Cancelled'); process.exit(0); }
  return value as T;
};

const fmtTxn = (t: Transaction) => {
  const amount = t.shares * t.price;
  const detail = (t.type === 'dividend' || t.type === 'tax')
    ? `$${amount.toFixed(2)}`
    : `${t.shares} @ $${t.price.toFixed(2)} = $${amount.toFixed(2)}`;
  return `${pc.dim(t.date)}  ${pc.bold(t.ticker.padEnd(6))} ${t.type.padEnd(9)} ${detail}`;
};

export const deleteTxnCommand = async (idArg?: string) => {
  const repo = getRepository();

  if (idArg) {
    const id = Number(idArg);
    if (!Number.isInteger(id) || id <= 0) {
      log.error(`Invalid id: ${idArg}`);
      process.exit(1);
    }
    const txn = repo.transactions.getById(id);
    if (!txn) {
      log.error(`Transaction #${id} not found.`);
      process.exit(1);
    }
    log.message(fmtTxn(txn));
    const ok = guard(await confirm({ message: 'Delete this transaction?', initialValue: false })) as boolean;
    if (!ok) { cancel('Cancelled'); return; }
    repo.transactions.delete(id);
    log.success(`Deleted transaction #${id}.`);
    return;
  }

  const all = repo.transactions.getAll();
  if (all.length === 0) {
    log.warn('No transactions to delete.');
    return;
  }

  const recent = [...all].reverse().slice(0, 30);
  const id = guard(await select({
    message: 'Select transaction to delete',
    options: recent.map(t => ({ value: t.id, label: fmtTxn(t) })),
  })) as number;

  const txn = repo.transactions.getById(id)!;
  const ok = guard(await confirm({
    message: `Delete ${txn.ticker} ${txn.type} on ${txn.date}?`,
    initialValue: false,
  })) as boolean;
  if (!ok) { cancel('Cancelled'); return; }

  repo.transactions.delete(id);
  log.success(`Deleted transaction #${id}.`);
};

const pickPeriod = async (label: string, periods: string[]): Promise<string> => {
  if (periods.length === 0) {
    log.warn('No entries to delete.');
    process.exit(0);
  }
  return guard(await select({
    message: label,
    options: periods.map(p => ({ value: p, label: p })),
  })) as string;
};

const resolvePeriod = (arg: string | undefined, periods: string[], label: string) => {
  if (!arg) return null;
  if (!/^\d{4}-\d{2}$/.test(arg)) {
    log.error(`Invalid period "${arg}". Use YYYY-MM format.`);
    process.exit(1);
  }
  if (!periods.includes(arg)) {
    log.error(`No ${label} entries for ${arg}.`);
    process.exit(1);
  }
  return arg;
};

export const deleteBalanceCommand = async (periodArg?: string) => {
  const repo = getRepository();
  const periods = repo.balance.getPeriods();
  const period = resolvePeriod(periodArg, periods, 'balance')
    ?? await pickPeriod('Select period to delete', periods);

  const entries = repo.balance.getByPeriod(period);
  const totalAssets      = entries.filter(e => e.type === 'asset').reduce((s, e) => s + e.amount, 0);
  const totalLiabilities = entries.filter(e => e.type === 'liability').reduce((s, e) => s + e.amount, 0);

  log.message([
    `${pc.dim('Period:')} ${period}`,
    `${pc.dim('Entries:')} ${entries.length}`,
    `${pc.dim('Assets:')} ${totalAssets.toLocaleString('en-US')} KRW`,
    `${pc.dim('Liabilities:')} ${totalLiabilities.toLocaleString('en-US')} KRW`,
  ].join('\n'));

  const ok = guard(await confirm({
    message: `Delete all balance entries for ${period}?`, initialValue: false,
  })) as boolean;
  if (!ok) { cancel('Cancelled'); return; }

  const deleted = repo.balance.deleteByPeriod(period);
  log.success(`Deleted ${deleted} balance entr${deleted === 1 ? 'y' : 'ies'} for ${period}.`);
};

export const deleteFlowCommand = async (periodArg?: string) => {
  const repo = getRepository();
  const periods = repo.flow.getPeriods();
  const period = resolvePeriod(periodArg, periods, 'flow')
    ?? await pickPeriod('Select period to delete', periods);

  const entries = repo.flow.getByPeriod(period);
  const totalIncome   = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpenses = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

  log.message([
    `${pc.dim('Period:')} ${period}`,
    `${pc.dim('Entries:')} ${entries.length}`,
    `${pc.dim('Income:')} ${totalIncome.toLocaleString('en-US')} KRW`,
    `${pc.dim('Expenses:')} ${totalExpenses.toLocaleString('en-US')} KRW`,
  ].join('\n'));

  const ok = guard(await confirm({
    message: `Delete all flow entries for ${period}?`, initialValue: false,
  })) as boolean;
  if (!ok) { cancel('Cancelled'); return; }

  const deleted = repo.flow.deleteByPeriod(period);
  log.success(`Deleted ${deleted} flow entr${deleted === 1 ? 'y' : 'ies'} for ${period}.`);
};
