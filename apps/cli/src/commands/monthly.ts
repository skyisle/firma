import { text, log } from '@clack/prompts';
import pc from 'picocolors';
import { currentPeriod, guard } from '../utils/index.ts';
import { addBalanceCommand } from './balance.ts';
import { addFlowCommand } from './flow.ts';

export const addMonthlyCommand = async ({ period }: { period?: string } = {}) => {
  const resolvedPeriod = period ?? (guard(await text({
    message: 'Period (YYYY-MM)',
    initialValue: currentPeriod(),
    validate: v => !/^\d{4}-\d{2}$/.test(v.trim()) ? 'Format: YYYY-MM' : undefined,
  })) as string).trim();

  log.message(pc.bold('\n━━  BALANCE SHEET  ━━━━━━━━━━━━━━━━━━━━━'));
  await addBalanceCommand({ period: resolvedPeriod });

  log.message(pc.bold('\n━━  CASH FLOW  ━━━━━━━━━━━━━━━━━━━━━━━━━'));
  await addFlowCommand({ period: resolvedPeriod });
};
