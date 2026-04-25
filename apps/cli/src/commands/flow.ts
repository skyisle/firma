import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { FLOW_CATEGORIES } from '@firma/utils';
import { getDb, flowEntries, getRepository } from '../db/index.ts';
import { eq } from 'drizzle-orm';
import { inputCategoryGroup, currentPeriod, periodEndDate, type EntryResult } from './ledger-input.ts';

export const flowCommand = async ({ json = false, period }: { json?: boolean; period?: string } = {}) => {
  const targetPeriod = period ?? currentPeriod();

  if (json) {
    const repo = getRepository();
    const entries = repo.flow.getByPeriod(targetPeriod);
    const income = entries.filter(e => e.type === 'income');
    const expenses = entries.filter(e => e.type === 'expense');
    const total_income = income.reduce((s, e) => s + e.amount, 0);
    const total_expenses = expenses.reduce((s, e) => s + e.amount, 0);
    process.stdout.write(JSON.stringify({
      period: targetPeriod,
      entries,
      total_income,
      total_expenses,
      net_flow: total_income - total_expenses,
    }, null, 2) + '\n');
    return;
  }

  const db = getDb();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  const existing = db.select().from(flowEntries)
    .where(eq(flowEntries.period, targetPeriod)).all();
  const existingMap = new Map(existing.map(e => [e.category, e.amount]));

  const income = FLOW_CATEGORIES.filter(c => c.type === 'income');
  const expense = FLOW_CATEGORIES.filter(c => c.type === 'expense');

  log.message(pc.bold('── INCOME ───────────────────────────────'));
  const incomeEntries = await inputCategoryGroup(income, existingMap);

  log.message(pc.bold('\n── EXPENSES ─────────────────────────────'));
  const expenseEntries = await inputCategoryGroup(expense, existingMap);

  const allEntries: EntryResult[] = [...incomeEntries, ...expenseEntries];

  for (const e of allEntries) {
    db.insert(flowEntries).values({
      period: targetPeriod,
      date,
      type: e.type,
      sub_type: e.sub_type,
      category: e.category,
      amount: e.amount,
      memo: e.memo ?? null,
    }).onConflictDoUpdate({
      target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
      set: { amount: e.amount, date, memo: e.memo ?? null },
    }).run();
  }

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
