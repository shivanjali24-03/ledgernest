import { describe, expect, it } from 'vitest';
import { panFromGstin, tdsOn, tdsSchema, TDS_SECTIONS } from './index.js';

describe('TDS', () => {
  it('works out TDS rounded to the rupee', () => {
    expect(tdsOn(50_000_00, 100_000)).toBe(5_000_00);
    expect(tdsOn(12_345_67, 20_000)).toBe(247_00);
    expect(tdsOn(1_00, 10_000)).toBe(0);
  });

  it('reads the PAN out of a GSTIN', () => {
    expect(panFromGstin('27ABZPS6519M1ZQ')).toBe('ABZPS6519M');
    expect(panFromGstin('27abzps6519m1zq')).toBe('ABZPS6519M');
    expect(panFromGstin('not a gstin')).toBeNull();
    expect(panFromGstin(null)).toBeNull();
  });

  it('checks what is kept back, and has no TDS unless asked', () => {
    expect(tdsSchema.parse(undefined)).toBeNull();
    const ok = { section: '194J', ratePpm: 100_000, base: 50_000_00, amount: 5_000_00, accountId: '0b8f1b0e-8a8c-4d6c-9c4a-1f2e3d4c5b6a' };
    expect(tdsSchema.parse(ok)).toEqual(ok);
    expect(tdsSchema.safeParse({ ...ok, section: '999X' }).success).toBe(false);
    expect(tdsSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(TDS_SECTIONS.find((s) => s.code === '194C')!.rates.map((r) => r.ppm)).toEqual([10_000, 20_000]);
  });
});
