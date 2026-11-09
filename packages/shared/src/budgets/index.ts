import { z } from 'zod';
import { MAX_LINE_AMOUNT } from '../journals/index.js';

/** Starting a budget: last year's actuals (up or down by a percentage), another budget, or nothing */
export const budgetCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the budget.').max(120),
  fiscalYearId: z.uuid(),
  startFrom: z.enum(['actuals', 'budget', 'empty']).default('actuals'),
  /** When starting from another budget */
  budgetId: z.uuid().nullable().optional().default(null),
  /** Up or down on what it starts from, e.g. 10 or -5 */
  adjustPercent: z.number().min(-100).max(1000).optional().default(0),
});
export type BudgetCreateInput = z.input<typeof budgetCreateSchema>;

/** Amounts for accounts, twelve months each from the year's first; income and expenses both positive */
export const budgetLinesSchema = z.object({
  lines: z
    .array(z.object({ accountId: z.uuid(), amounts: z.array(z.number().int().min(-MAX_LINE_AMOUNT).max(MAX_LINE_AMOUNT)).length(12) }))
    .max(2000),
});
export type BudgetLinesInput = z.input<typeof budgetLinesSchema>;

export const budgetRenameSchema = z.object({ name: z.string().trim().min(1).max(120) });

/** The twelve months of a financial year, as "2026-04" … "2027-03" */
export function yearMonths(startDate: string): string[] {
  const [y, m] = startDate.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_v, k) => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7));
}

/** Variance that reads the right way round: above budget is good for income and bad for expenses */
export const favourable = (type: string, budget: number, actual: number) => (type === 'income' ? actual - budget : budget - actual);
