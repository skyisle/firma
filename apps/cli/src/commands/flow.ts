import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { FLOW_CATEGORIES } from '@firma/utils';
import { getRepository } from '../db/index.ts';
import { inputCategoryGroup, currentPeriod, periodEndDate, type EntryResult } from './ledger-input.ts';

export const addFlowCommand = async ({ period }: { period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  const existing = repo.flow.getByPeriod(targetPeriod);
  const existingMap = new Map(existing.map(e => [e.category, e.amount]));

  const income  = FLOW_CATEGORIES.filter(c => c.type === 'income');
  const expense = FLOW_CATEGORIES.filter(c => c.type === 'expense');

  log.message(pc.bold('── INCOME ───────────────────────────────'));
  const incomeEntries = await inputCategoryGroup(income, existingMap);

  log.message(pc.bold('\n── EXPENSES ─────────────────────────────'));
  const expenseEntries = await inputCategoryGroup(expense, existingMap);

  const allEntries: EntryResult[] = [...incomeEntries, ...expenseEntries];
  for (const e of allEntries) {
    repo.flow.upsert({
      period: targetPeriod, date, type: e.type, sub_type: e.sub_type,
      category: e.category, amount: e.amount, memo: e.memo ?? null,
    });
  }

  const totalIncome  = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const totalExpense = expenseEntries.reduce((s, e) => s + e.amount, 0);
  const netFlow      = totalIncome - totalExpense;
  const colorNet     = netFlow >= 0 ? pc.green : pc.red;

  const summary = [
    `${'Income'.padEnd(16)}${totalIncome.toLocaleString('en-US')} KRW`,
    `${'Expenses'.padEnd(16)}${totalExpense.toLocaleString('en-US')} KRW`,
    pc.dim('─'.repeat(36)),
    `${'Net Flow'.padEnd(16)}${colorNet(pc.bold(netFlow.toLocaleString('en-US')))} KRW`,
  ].join('\n');

  note(summary, `Cash Flow  ${targetPeriod}`);
};

export const showFlowCommand = async ({ json = false, period }: { json?: boolean; period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();
  const entries = repo.flow.getByPeriod(targetPeriod);

  const income         = entries.filter(e => e.type === 'income');
  const expenses       = entries.filter(e => e.type === 'expense');
  const total_income   = income.reduce((s, e) => s + e.amount, 0);
  const total_expenses = expenses.reduce((s, e) => s + e.amount, 0);
  const net_flow       = total_income - total_expenses;

  if (json) {
    process.stdout.write(JSON.stringify({
      period: targetPeriod, entries, total_income, total_expenses, net_flow,
    }, null, 2) + '\n');
    return;
  }

  if (entries.length === 0) {
    log.warn(`No flow entries for ${targetPeriod}. Run \`firma add flow\`.`);
    return;
  }

  const renderRows = (group: typeof entries) =>
    group.length === 0 ? [pc.dim('  (none)')]
      : group.map(e => `  ${pc.dim(e.category.padEnd(20))}${e.amount.toLocaleString('en-US').padStart(14)} KRW`);

  const colorNet = net_flow >= 0 ? pc.green : pc.red;

  const body = [
    pc.bold('INCOME'),
    ...renderRows(income),
    '',
    pc.bold('EXPENSES'),
    ...renderRows(expenses),
    pc.dim('─'.repeat(40)),
    `${'Income'.padEnd(20)}${total_income.toLocaleString('en-US').padStart(14)} KRW`,
    `${'Expenses'.padEnd(20)}${total_expenses.toLocaleString('en-US').padStart(14)} KRW`,
    `${pc.bold('Net Flow'.padEnd(20))}${colorNet(pc.bold(net_flow.toLocaleString('en-US').padStart(14)))} KRW`,
  ].join('\n');

  note(body, `Cash Flow  ${targetPeriod}`);
};
