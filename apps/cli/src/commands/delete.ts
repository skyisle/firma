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
