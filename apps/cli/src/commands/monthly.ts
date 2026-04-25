import { text, isCancel, cancel, log } from '@clack/prompts';
import pc from 'picocolors';
import { addBalanceCommand } from './balance.ts';
import { addFlowCommand } from './flow.ts';
import { currentPeriod } from './ledger-input.ts';

export const addMonthlyCommand = async ({ period }: { period?: string } = {}) => {
  let resolvedPeriod = period;

  if (!resolvedPeriod) {
    const periodInput = await text({
      message: 'Period (YYYY-MM)',
      initialValue: currentPeriod(),
      validate: v => !/^\d{4}-\d{2}$/.test(v.trim()) ? 'Format: YYYY-MM' : undefined,
    });
    if (isCancel(periodInput)) { cancel('Cancelled'); process.exit(0); }
    resolvedPeriod = String(periodInput).trim();
  }

  log.message(pc.bold('\n━━  BALANCE SHEET  ━━━━━━━━━━━━━━━━━━━━━'));
  await addBalanceCommand({ period: resolvedPeriod });

  log.message(pc.bold('\n━━  CASH FLOW  ━━━━━━━━━━━━━━━━━━━━━━━━━'));
  await addFlowCommand({ period: resolvedPeriod });
};
