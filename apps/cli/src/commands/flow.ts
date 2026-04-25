import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { FLOW_CATEGORIES } from '@firma/utils';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';
import { inputCategoryGroup, currentPeriod, periodEndDate, type EntryResult } from './ledger-input.ts';

type ExistingEntry = { category: string; amount: number };

export const flowCommand = async (period?: string) => {
  const { token } = requireAuth();
  const targetPeriod = period ?? currentPeriod();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  const existing = await apiFetch<ExistingEntry[]>(`/api/flow?period=${targetPeriod}`, { token });
  const existingMap = new Map(existing.map(e => [e.category, e.amount]));

  const income = FLOW_CATEGORIES.filter(c => c.type === 'income');
  const expense = FLOW_CATEGORIES.filter(c => c.type === 'expense');

  log.message(pc.bold('── INCOME ───────────────────────────────'));
  const incomeEntries = await inputCategoryGroup(income, existingMap);

  log.message(pc.bold('\n── EXPENSES ─────────────────────────────'));
  const expenseEntries = await inputCategoryGroup(expense, existingMap);

  const allEntries: EntryResult[] = [...incomeEntries, ...expenseEntries];

  await apiFetch('/api/flow', {
    method: 'POST',
    token,
    body: { period: targetPeriod, date, entries: allEntries },
  });

  const totalIncome = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const totalExpense = expenseEntries.reduce((s, e) => s + e.amount, 0);
  const netFlow = totalIncome - totalExpense;
  const colorNet = netFlow >= 0 ? pc.green : pc.red;

  const summary = [
    `${'Income'.padEnd(16)}${totalIncome.toLocaleString('en-US')} KRW`,
    `${'Expenses'.padEnd(16)}${totalExpense.toLocaleString('en-US')} KRW`,
    pc.dim('─'.repeat(36)),
    `${'Net Flow'.padEnd(16)}${colorNet(pc.bold(netFlow.toLocaleString('en-US')))} KRW`,
  ].join('\n');

  note(summary, `Cash Flow  ${targetPeriod}`);
};
