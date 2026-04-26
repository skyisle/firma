import { text, log } from '@clack/prompts';
import pc from 'picocolors';
import { guard } from '../utils/index.ts';

type CategoryDef = {
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

const fmtAmt = (n: number, symbol?: string) =>
  n === 0 ? pc.dim('0') : pc.cyan(`${symbol ?? ''}${n.toLocaleString('en-US')}`);

export const inputCategoryGroup = async (
  categories: CategoryDef[],
  existingMap: Map<string, number>,
  autoFillMap: Map<string, number> = new Map(),
  displaySymbol?: string,
): Promise<EntryResult[]> => {
  const results: EntryResult[] = [];
  const subTypes = [...new Set(categories.map(c => c.subType))];

  for (const subType of subTypes) {
    const group = categories.filter(c => c.subType === subType);
    log.message(pc.bold(`\n  ${subType.replace(/_/g, ' ').toUpperCase()}`));

    for (const cat of group) {
      if (cat.autoFilled && autoFillMap.has(cat.category)) {
        const amount = autoFillMap.get(cat.category)!;
        log.message(`  ${cat.label.padEnd(24)} ${fmtAmt(amount, displaySymbol)}  ${pc.dim('(auto)')}`);
        results.push({ type: cat.type, sub_type: cat.subType, category: cat.category, amount });
        continue;
      }

      const existing = existingMap.get(cat.category) ?? 0;
      const answer = guard(await text({
        message: cat.label,
        initialValue: existing > 0 ? String(existing) : '',
        placeholder: '0',
      })) as string;

      const amount = parseAmount(answer) ?? existing;
      results.push({ type: cat.type, sub_type: cat.subType, category: cat.category, amount });
    }
  }

  return results;
};
