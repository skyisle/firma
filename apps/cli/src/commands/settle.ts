import { text, isCancel, cancel, log } from '@clack/prompts';
import pc from 'picocolors';
import { currentPeriod } from './ledger-input.ts';
import { getRepository } from '../db/index.ts';
import { balanceCommand } from './balance.ts';
import { flowCommand } from './flow.ts';

export const settleCommand = async ({ json = false, period }: { json?: boolean; period?: string } = {}) => {
  if (json) {
    const targetPeriod = period ?? currentPeriod();
    const repo = getRepository();
    const balEntries = repo.balance.getByPeriod(targetPeriod);
    const flowEnts = repo.flow.getByPeriod(targetPeriod);

    const assets = balEntries.filter(e => e.type === 'asset');
    const liabilities = balEntries.filter(e => e.type === 'liability');
    const total_assets = assets.reduce((s, e) => s + e.amount, 0);
    const total_liabilities = liabilities.reduce((s, e) => s + e.amount, 0);

    const income = flowEnts.filter(e => e.type === 'income');
    const expenses = flowEnts.filter(e => e.type === 'expense');
    const total_income = income.reduce((s, e) => s + e.amount, 0);
    const total_expenses = expenses.reduce((s, e) => s + e.amount, 0);

    process.stdout.write(JSON.stringify({
      period: targetPeriod,
      balance: { entries: balEntries, total_assets, total_liabilities, net_worth: total_assets - total_liabilities },
      flow: { entries: flowEnts, total_income, total_expenses, net_flow: total_income - total_expenses },
    }, null, 2) + '\n');
    return;
  }

  const defaultPeriod = currentPeriod();
  const periodInput = await text({
    message: 'Period (YYYY-MM)',
    initialValue: defaultPeriod,
    validate: v => !/^\d{4}-\d{2}$/.test(v.trim()) ? 'Format: YYYY-MM' : undefined,
  });

  if (isCancel(periodInput)) { cancel('Cancelled'); process.exit(0); }
  const resolvedPeriod = String(periodInput).trim();

  log.message(pc.bold('\n━━  BALANCE SHEET  ━━━━━━━━━━━━━━━━━━━━━'));
  await balanceCommand({ period: resolvedPeriod });

  log.message(pc.bold('\n━━  CASH FLOW  ━━━━━━━━━━━━━━━━━━━━━━━━━'));
  await flowCommand({ period: resolvedPeriod });
};
