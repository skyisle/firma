import { text, isCancel, cancel, log } from '@clack/prompts';
import pc from 'picocolors';
import { currentPeriod } from './ledger-input.ts';
import { balanceCommand } from './balance.ts';
import { flowCommand } from './flow.ts';

export const settleCommand = async () => {
  const defaultPeriod = currentPeriod();
  const periodInput = await text({
    message: 'Period (YYYY-MM)',
    initialValue: defaultPeriod,
    validate: v => !/^\d{4}-\d{2}$/.test(v.trim()) ? 'Format: YYYY-MM' : undefined,
  });

  if (isCancel(periodInput)) { cancel('Cancelled'); process.exit(0); }
  const period = String(periodInput).trim();

  log.message(pc.bold('\n━━  BALANCE SHEET  ━━━━━━━━━━━━━━━━━━━━━'));
  await balanceCommand(period);

  log.message(pc.bold('\n━━  CASH FLOW  ━━━━━━━━━━━━━━━━━━━━━━━━━'));
  await flowCommand(period);
};
