import { text, isCancel, cancel, log } from '@clack/prompts';
import pc from 'picocolors';

export type CategoryDef = {
  type: string;
  subType: string;
  category: string;
  label: string;
  autoFilled?: boolean;
};

export type EntryResult = {
  type: string;
  sub_type: string;
  category: string;
  amount: number;
  memo?: string;
};

const parseAmount = (val: string): number | undefined => {
  const n = parseInt(val.replace(/,/g, ''), 10);
  return isNaN(n) || n < 0 ? undefined : n;
};

const fmtAmount = (n: number) =>
  n === 0 ? pc.dim('0') : pc.cyan(n.toLocaleString('en-US'));

export const inputCategoryGroup = async (
  categories: CategoryDef[],
  existingMap: Map<string, number>,
  autoFillMap: Map<string, number> = new Map(),
): Promise<EntryResult[]> => {
  const results: EntryResult[] = [];
  const subTypes = [...new Set(categories.map(c => c.subType))];

  for (const subType of subTypes) {
    const group = categories.filter(c => c.subType === subType);
    log.message(pc.bold(`\n  ${subType.replace(/_/g, ' ').toUpperCase()}`));

    for (const cat of group) {
      if (cat.autoFilled && autoFillMap.has(cat.category)) {
        const amount = autoFillMap.get(cat.category)!;
        log.message(`  ${cat.label.padEnd(24)} ${fmtAmount(amount)}  ${pc.dim('(auto)')}`);
        results.push({ type: cat.type, sub_type: cat.subType, category: cat.category, amount });
        continue;
      }

      const existing = existingMap.get(cat.category) ?? 0;
      const answer = await text({
        message: cat.label,
        initialValue: existing > 0 ? String(existing) : '',
        placeholder: '0',
      });

      if (isCancel(answer)) {
        cancel('Cancelled');
        process.exit(0);
      }

      const amount = parseAmount(String(answer)) ?? existing;
      results.push({ type: cat.type, sub_type: cat.subType, category: cat.category, amount });
    }
  }

  return results;
};

export const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const periodEndDate = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).toISOString().split('T')[0];
};

export const printSummary = (label: string, entries: EntryResult[]) => {
  const total = entries.reduce((s, e) => s + e.amount, 0);
  log.message(`  ${pc.dim(label.padEnd(20))}${pc.bold(total.toLocaleString('en-US'))} KRW`);
};
