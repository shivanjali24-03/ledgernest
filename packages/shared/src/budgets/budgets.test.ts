import { describe, expect, it } from 'vitest';
import { budgetLinesSchema, favourable, yearMonths } from './index.js';

describe('budgets', () => {
  it('lists a financial year’s months across the calendar year', () => {
    expect(yearMonths('2026-04-01')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  });
  it('reads variance the right way round', () => {
    expect(favourable('income', 100, 120)).toBe(20);
    expect(favourable('expense', 100, 120)).toBe(-20);
  });
  it('needs twelve months per account', () => {
    expect(budgetLinesSchema.safeParse({ lines: [{ accountId: crypto.randomUUID(), amounts: [1, 2] }] }).success).toBe(false);
  });
});
