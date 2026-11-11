import { describe, expect, it } from 'vitest';
import { computePayslip, daysInMonth, employeeSchema, monthEnd, professionalTax, salaryIncomeTax } from './index.js';

const base = employeeSchema.parse({ code: 'E-1', name: 'Asha', dateOfJoining: '2026-04-01', basic: 0, stateCode: '27' });

describe('payroll', () => {
  it('works out income tax on salary under each regime, with the s.87A rebate and marginal relief', () => {
    // ₹12,75,000 gross: ₹12 lakh taxable, no tax under the new regime
    expect(salaryIncomeTax(12_75_000, 'new')).toBe(0);
    // ₹12,85,000: ₹10,000 over the limit, so tax is capped at that (plus cess)
    expect(salaryIncomeTax(12_85_000, 'new')).toBe(10_400);
    // ₹24,75,000 taxable 24L: 20k+40k+60k+80k+100k = 3,00,000 + 4% cess
    expect(salaryIncomeTax(24_75_000, 'new')).toBe(3_12_000);
    // Old regime: ₹10,50,000 → taxable 10L: 12,500 + 1,00,000 = 1,12,500 + cess
    expect(salaryIncomeTax(10_50_000, 'old')).toBe(1_17_000);
    expect(salaryIncomeTax(5_50_000, 'old')).toBe(0);
  });

  it('takes Maharashtra’s professional tax, ₹300 in February, women up to ₹25,000 exempt', () => {
    expect(professionalTax('27', 9_000_00, '2026-06', 'male')).toBe(175_00);
    expect(professionalTax('27', 30_000_00, '2027-02', 'male')).toBe(300_00);
    expect(professionalTax('27', 20_000_00, '2026-06', 'female')).toBe(0);
    expect(professionalTax('29', 30_000_00, '2026-06', null)).toBe(200_00);
    expect(professionalTax('07', 90_000_00, '2026-06', null)).toBe(0);
  });

  it('makes a payslip: PF on capped wages, ESI under ₹21,000, PT and TDS, days not paid taken off', () => {
    const p = computePayslip({ ...base, basic: 10_000_00, hra: 4_000_00, specialAllowance: 4_000_00 }, '2026-06');
    expect(p.gross).toBe(18_000_00);
    expect(p.deductions).toEqual([
      { code: 'pf', label: 'Provident fund', amount: 1_200_00 },
      { code: 'esi', label: 'ESI', amount: 135_00 },
      { code: 'pt', label: 'Professional tax', amount: 200_00 },
    ]);
    expect(p.employer.map((l) => [l.code, l.amount])).toEqual([
      ['pf_employer', 1_200_00],
      ['pf_admin', 50_00],
      ['edli', 50_00],
      ['esi_employer', 585_00],
    ]);
    expect(p.net).toBe(18_000_00 - 1_535_00);
    // Six days without pay in June (30 days): 24/30 of everything
    const lop = computePayslip({ ...base, basic: 10_000_00, hra: 4_000_00, specialAllowance: 4_000_00 }, '2026-06', 6);
    expect(lop).toMatchObject({ daysPaid: 24, gross: 14_400_00 });
  });

  it('caps PF wages at ₹15,000, leaves ESI above ₹21,000, and takes TDS on a high salary', () => {
    const p = computePayslip({ ...base, basic: 1_00_000_00, hra: 50_000_00, specialAllowance: 50_000_00 }, '2026-06');
    expect(p.deductions.find((l) => l.code === 'pf')?.amount).toBe(1_800_00);
    expect(p.deductions.some((l) => l.code === 'esi')).toBe(false);
    // ₹24 lakh a year: ₹23,25,000 taxable → 2,81,250 + cess = 2,92,500; a twelfth is 24,375
    expect(p.deductions.find((l) => l.code === 'tds')?.amount).toBe(24_375_00);
    expect(computePayslip({ ...base, basic: 1_00_000_00, pfCapped: false }, '2026-06').deductions.find((l) => l.code === 'pf')?.amount).toBe(12_000_00);
  });

  it('knows its months', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthEnd('2026-06')).toBe('2026-06-30');
  });
});
