import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/** Where each kind of income and expense sits in the profit and loss */
export const PNL_SECTIONS = ['revenue', 'costOfSales', 'operatingExpenses', 'otherIncome', 'otherExpenses'] as const;
export type PnlSection = (typeof PNL_SECTIONS)[number];
export const pnlSectionOf = (type: string, subtype: string): PnlSection | null =>
  type === 'income' ? (subtype === 'other_income' ? 'otherIncome' : 'revenue') : type === 'expense' ? (subtype === 'cost_of_sales' ? 'costOfSales' : subtype === 'other_expense' ? 'otherExpenses' : 'operatingExpenses') : null;

/** Where each balance sits on the balance sheet */
export const BS_SECTIONS = ['currentAssets', 'nonCurrentAssets', 'currentLiabilities', 'nonCurrentLiabilities', 'equity'] as const;
export type BsSection = (typeof BS_SECTIONS)[number];
export function bsSectionOf(type: string, subtype: string): BsSection | null {
  if (type === 'asset') return ['fixed_asset', 'other_asset'].includes(subtype) ? 'nonCurrentAssets' : 'currentAssets';
  if (type === 'liability') return ['long_term_liability', 'other_liability'].includes(subtype) ? 'nonCurrentLiabilities' : 'currentLiabilities';
  if (type === 'equity') return 'equity';
  return null;
}

export const PNL_COMPARE = ['none', 'previous', 'year', 'months'] as const;
export type PnlCompare = (typeof PNL_COMPARE)[number];

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addYears = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/**
 * The columns a profit and loss shows: the period itself, then the period before it (same length), the same
 * period a year earlier, or each calendar month in it (up to 24).
 */
export function pnlColumns(from: string, to: string, compare: PnlCompare): { from: string; to: string }[] {
  if (compare === 'previous') {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    return [{ from, to }, { from: addDays(from, -days - 1), to: addDays(from, -1) }];
  }
  if (compare === 'year') return [{ from, to }, { from: addYears(from, -1), to: addYears(to, -1) }];
  if (compare === 'months') {
    const out: { from: string; to: string }[] = [];
    let start = from;
    while (start <= to && out.length < 24) {
      const [y, m] = start.split('-').map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      out.push({ from: start, to: end < to ? end : to });
      start = addDays(end, 1);
    }
    return out;
  }
  return [{ from, to }];
}

export const pnlQuerySchema = z
  .object({ from: isoDaySchema, to: isoDaySchema, compare: z.enum(PNL_COMPARE).default('none') })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });
export const balanceSheetQuerySchema = z.object({ asOf: isoDaySchema.optional(), compareAsOf: isoDaySchema.optional() });
