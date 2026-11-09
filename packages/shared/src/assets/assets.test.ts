import { describe, expect, it } from 'vitest';
import { depreciationFor, fixedAssetSchema, monthShares } from './index.js';

const laptop = { method: 'straight_line' as const, cost: 12_000_000, residual: 0, accumulated: 0, usefulLifeMonths: 36, wdvRatePpm: null };

describe('depreciation', () => {
  it('splits days into months, part months by their days', () => {
    expect(monthShares('2026-04-16', '2026-06-30')).toEqual([
      { month: '2026-04', share: 0.5 },
      { month: '2026-05', share: 1 },
      { month: '2026-06', share: 1 },
    ]);
  });
  it('spreads straight-line evenly, a half month for half the days', () => {
    // ₹1,20,000 over 36 months is ₹3,333.33 a month
    expect(depreciationFor(laptop, '2026-04-01', '2026-04-30')).toBe(333_333);
    expect(depreciationFor(laptop, '2026-04-16', '2026-06-30')).toBe(833_333);
  });
  it('never goes below the residual value', () => {
    expect(depreciationFor({ ...laptop, residual: 1_000_000, accumulated: 10_900_000 }, '2026-04-01', '2026-12-31')).toBe(100_000);
    expect(depreciationFor({ ...laptop, accumulated: 12_000_000 }, '2026-04-01', '2026-04-30')).toBe(0);
  });
  it('charges written-down value on what is left, month by month', () => {
    // 40% a year on ₹1,00,000: ₹3,333.33 in the first month, a little less in the next
    const car = { method: 'wdv' as const, cost: 10_000_000, residual: 0, accumulated: 0, usefulLifeMonths: null, wdvRatePpm: 400_000 };
    expect(depreciationFor(car, '2026-04-01', '2026-04-30')).toBe(333_333);
    expect(depreciationFor(car, '2026-04-01', '2026-05-31')).toBe(333_333 + 322_222);
  });
  it('validates an asset', () => {
    const base = { name: 'Laptop', costAccountId: crypto.randomUUID(), accumulatedAccountId: crypto.randomUUID(), expenseAccountId: crypto.randomUUID(), cost: 100, inServiceDate: '2026-04-01', method: 'straight_line' };
    expect(fixedAssetSchema.safeParse({ ...base, usefulLifeMonths: 36 }).success).toBe(true);
    expect(fixedAssetSchema.safeParse(base).success).toBe(false);
    expect(fixedAssetSchema.safeParse({ ...base, method: 'wdv', wdvRate: '15' }).data?.wdvRate).toBe(150_000);
    expect(fixedAssetSchema.safeParse({ ...base, usefulLifeMonths: 36, residual: 100 }).success).toBe(false);
  });
});
