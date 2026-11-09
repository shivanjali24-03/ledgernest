import { describe, expect, it } from 'vitest';
import { findIndianState, formatRate, gstSlabCreateSchema, gstSlabUpdateSchema, gstinCheckChar, isGstin, percentToPpm, slabInForce, splitTax, taxGroupCreateSchema, taxRole } from './index.js';

describe('rates', () => {
  it('converts percentages to parts per million and back, exactly', () => {
    expect(percentToPpm('18')).toBe(180_000);
    expect(percentToPpm('0.25')).toBe(2_500);
    expect(percentToPpm('0.125%')).toBe(1_250);
    expect(percentToPpm(40)).toBe(400_000);
    expect(percentToPpm('100')).toBe(1_000_000);
    for (const bad of ['', '-5', '101', '1.23456', 'abc', '1e2']) expect(percentToPpm(bad)).toBeNull();
    expect(formatRate(180_000)).toBe('18%');
    expect(formatRate(1_250)).toBe('0.125%');
    expect(formatRate(2_500)).toBe('0.25%');
    expect(formatRate(0)).toBe('0%');
  });
});

describe('GST slabs', () => {
  it('accepts a slab that splits evenly into CGST and SGST halves', () => {
    expect(gstSlabCreateSchema.parse({ rate: '0.25', label: 'Rough diamonds', effectiveFrom: '2017-07-01' })).toMatchObject({ rate: 2_500, effectiveTo: null, description: null });
    expect(gstSlabCreateSchema.safeParse({ rate: '0.0001', label: 'Odd', effectiveFrom: '2026-01-01' }).success).toBe(false);
    expect(gstSlabCreateSchema.safeParse({ rate: '18', label: 'Std', effectiveFrom: '2026-01-01', effectiveTo: '2025-12-31' }).success).toBe(false);
    expect(gstSlabUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('knows whether a slab is in force on a day, ends included', () => {
    const retired = { effectiveFrom: '2017-07-01', effectiveTo: '2025-09-21' };
    expect(slabInForce(retired, '2025-09-21')).toBe(true);
    expect(slabInForce(retired, '2025-09-22')).toBe(false);
    expect(slabInForce({ effectiveFrom: '2025-09-22', effectiveTo: null }, '2026-11-09')).toBe(true);
    expect(slabInForce({ effectiveFrom: '2025-09-22', effectiveTo: null }, '2025-09-21')).toBe(false);
  });
});

describe('India', () => {
  it('finds a state by name or GST code, and knows which charge UTGST', () => {
    expect(findIndianState('Tamil Nadu')?.code).toBe('33');
    expect(findIndianState('tamil-nadu')?.code).toBe('33');
    expect(findIndianState('27')?.name).toBe('Maharashtra');
    expect(findIndianState('7')?.name).toBe('Delhi');
    expect(findIndianState('Andaman & Nicobar Islands')?.utgst).toBe(true);
    expect(findIndianState('Chandigarh')?.utgst).toBe(true);
    // Delhi and Puducherry have legislatures, so they charge SGST
    expect(findIndianState('Delhi')?.utgst).toBe(false);
    expect(findIndianState('Puducherry')?.utgst).toBe(false);
    expect(findIndianState('Atlantis')).toBeNull();
    expect(findIndianState(null)).toBeNull();
  });

  it('validates GSTINs, including the check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isGstin(' 27aapfu0939f1zv ')).toBe(true);
    expect(isGstin('27AAPFU0939F1ZW')).toBe(false); // wrong check character
    expect(isGstin('99AAPFU0939F1ZV')).toBe(false); // no such state
    expect(isGstin('27AAPFU0939F1Z')).toBe(false);
  });
});

describe('tax on a line', () => {
  const gst18 = [
    { rateId: 'cgst', ratePpm: 90_000 },
    { rateId: 'sgst', ratePpm: 90_000 },
  ];

  it('adds each component on top of an exclusive amount, rounding each one', () => {
    expect(splitTax(100_000, false, gst18)).toEqual({ net: 100_000, taxes: [{ rateId: 'cgst', amount: 9_000 }, { rateId: 'sgst', amount: 9_000 }] });
    // ₹0.55 at 9%: 4.95 paise → 5 each (half rounds up)
    expect(splitTax(55, false, gst18).taxes.map((t) => t.amount)).toEqual([5, 5]);
    // 0.125% halves of the 0.25% slab
    expect(splitTax(1_000_000, false, [{ rateId: 'c', ratePpm: 1_250 }]).taxes[0]!.amount).toBe(1_250);
  });

  it('backs the tax out of an inclusive amount and never loses a paisa', () => {
    expect(splitTax(118_000, true, gst18)).toEqual({ net: 100_000, taxes: [{ rateId: 'cgst', amount: 9_000 }, { rateId: 'sgst', amount: 9_000 }] });
    for (const gross of [1, 99, 101, 999_999, 123_457, 5_000_001]) {
      const r = splitTax(gross, true, gst18);
      expect(r.net + r.taxes.reduce((s, t) => s + t.amount, 0)).toBe(gross);
      expect(r.net).toBeGreaterThanOrEqual(0);
    }
    expect(splitTax(500, true, [])).toEqual({ net: 500, taxes: [] });
  });

  it('stays exact at the largest amounts', () => {
    const r = splitTax(1_000_000_000_000_000, false, [{ rateId: 'x', ratePpm: 400_000 }]);
    expect(r.taxes[0]!.amount).toBe(400_000_000_000_000);
  });

  it('puts sales on the output side and purchases on the input side', () => {
    expect(taxRole('income')).toBe('output');
    expect(taxRole('expense')).toBe('input');
    expect(taxRole('asset')).toBe('input');
    expect(taxRole('liability')).toBe('output');
  });

  it('allows each rate in a group once', () => {
    const id = '7f1d3c1e-8a0b-4c2d-9e3f-1a2b3c4d5e6f';
    expect(taxGroupCreateSchema.safeParse({ name: 'GST 18%', rateIds: [id, id] }).success).toBe(false);
    expect(taxGroupCreateSchema.safeParse({ name: 'GST 18%', rateIds: [] }).success).toBe(false);
  });
});

describe('updates', () => {
  it('change only what was sent, and refuse fields that can never change', async () => {
    const { taxRateUpdateSchema } = await import('./index.js');
    expect(taxRateUpdateSchema.parse({ name: 'Standard VAT' })).toEqual({ name: 'Standard VAT' });
    expect(taxRateUpdateSchema.safeParse({ rate: '17.5' }).success).toBe(false);
    expect(gstSlabUpdateSchema.safeParse({ rate: '20' }).success).toBe(false);
    expect(gstSlabUpdateSchema.parse({ label: 'Standard' })).toEqual({ label: 'Standard' });
  });
});

describe('expanding lines', () => {
  const rates = { g18: [{ id: 'c', ratePpm: 90_000, outputAccountId: 'cOut', inputAccountId: 'cIn' }, { id: 's', ratePpm: 90_000, outputAccountId: 'sOut', inputAccountId: 'sIn' }], g0: [{ id: 'z', ratePpm: 0, outputAccountId: 'zOut', inputAccountId: null }] };
  const types: Record<string, string> = { bank: 'asset', sales: 'income', rent: 'expense' };
  const expand = async (lines: Parameters<typeof import('./index.js').expandTax>[0]) => (await import('./index.js')).expandTax(lines, (g) => rates[g as keyof typeof rates], (a) => types[a]);

  it('follows a taxed sale with its tax lines, and a purchase claims input credit', async () => {
    const { rows } = await expand([
      { accountId: 'bank', description: null, debit: 11_800, credit: 0 },
      { accountId: 'sales', description: 'Sale', debit: 0, credit: 10_000, taxGroupId: 'g18' },
      { accountId: 'rent', description: null, debit: 1_180, credit: 0, taxGroupId: 'g18', taxInclusive: true },
    ]);
    expect(rows.map((r) => [r.lineNo, r.accountId, r.debit, r.credit, r.taxRateId, r.taxSourceLine])).toEqual([
      [1, 'bank', 11_800, 0, null, null],
      [2, 'sales', 0, 10_000, null, null],
      [3, 'cOut', 0, 900, 'c', 2],
      [4, 'sOut', 0, 900, 's', 2],
      [5, 'rent', 1_000, 0, null, null],
      [6, 'cIn', 90, 0, 'c', 5],
      [7, 'sIn', 90, 0, 's', 5],
    ]);
  });

  it('adds no line for a 0% tax, and round-trips back to what was entered', async () => {
    const { enteredLines } = await import('./index.js');
    const entered = [
      { accountId: 'sales', description: null, debit: 0, credit: 5_000, taxGroupId: 'g0', taxInclusive: false },
      { accountId: 'rent', description: null, debit: 1_181, credit: 0, taxGroupId: 'g18', taxInclusive: true },
    ];
    const { rows } = await expand(entered);
    expect(rows.filter((r) => r.taxRateId)).toHaveLength(2);
    expect(enteredLines(rows)).toEqual(entered.map((l) => ({ ...l })));
  });
});
