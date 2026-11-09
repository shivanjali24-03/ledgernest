import { describe, expect, it } from 'vitest';
import { bsSectionOf, pnlColumns, pnlSectionOf } from './index.js';

describe('financial statements', () => {
  it('sorts accounts into statement sections', () => {
    expect(pnlSectionOf('income', 'operating_income')).toBe('revenue');
    expect(pnlSectionOf('expense', 'cost_of_sales')).toBe('costOfSales');
    expect(pnlSectionOf('expense', 'payroll')).toBe('operatingExpenses');
    expect(pnlSectionOf('asset', 'bank')).toBeNull();
    expect(bsSectionOf('asset', 'fixed_asset')).toBe('nonCurrentAssets');
    expect(bsSectionOf('liability', 'tax_payable')).toBe('currentLiabilities');
    expect(bsSectionOf('income', 'other_income')).toBeNull();
  });
  it('builds comparison columns', () => {
    expect(pnlColumns('2026-04-01', '2026-06-30', 'previous')).toEqual([
      { from: '2026-04-01', to: '2026-06-30' },
      { from: '2025-12-31', to: '2026-03-31' },
    ]);
    expect(pnlColumns('2024-02-01', '2024-02-29', 'year')[1]).toEqual({ from: '2023-02-01', to: '2023-02-28' });
    expect(pnlColumns('2026-04-15', '2026-06-10', 'months')).toEqual([
      { from: '2026-04-15', to: '2026-04-30' },
      { from: '2026-05-01', to: '2026-05-31' },
      { from: '2026-06-01', to: '2026-06-10' },
    ]);
  });
});
