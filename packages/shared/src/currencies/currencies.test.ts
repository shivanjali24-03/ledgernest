import { describe, expect, it } from 'vitest';
import { currencyAddSchema, currencyDigits, formatRateValue, isKnownCurrency, normaliseRate, parseRate, rateSchema, toBase } from './index.js';

describe('currencies', () => {
  it('knows real ISO currencies and their minor units', () => {
    expect(isKnownCurrency('USD')).toBe(true);
    expect(isKnownCurrency('XYZ')).toBe(false);
    expect([currencyDigits('INR'), currencyDigits('JPY'), currencyDigits('KWD')]).toEqual([2, 0, 3]);
    expect(currencyAddSchema.parse({ code: ' usd ' })).toEqual({ code: 'USD' });
    expect(currencyAddSchema.safeParse({ code: 'XYZ' }).success).toBe(false);
  });

  it('reads and writes rates exactly', () => {
    expect(parseRate('83.25')).toBe(832_500_000_000n);
    expect(formatRateValue(832_500_000_000n)).toBe('83.25');
    expect(normaliseRate('083.2500')).toBe('83.25');
    expect(normaliseRate('0.0000000001')).toBe('0.0000000001');
    for (const bad of ['0', '0.0', '-1', 'abc', '1.12345678901', '1e3', '']) expect(normaliseRate(bad)).toBeNull();
    expect(rateSchema.parse(93.92)).toBe('93.92');
  });

  it('converts to the base currency, rounding half away from zero', () => {
    expect(toBase(10_000, '83.25', 2, 2)).toBe(832_500); // USD 100.00 → ₹8,325.00
    expect(toBase(1_000, '0.56', 0, 2)).toBe(56_000); // JPY 1,000 → ₹560.00
    expect(toBase(1_000, '270.5', 3, 2)).toBe(27_050); // KWD 1.000 → ₹270.50
    expect(toBase(1, '0.5', 2, 2)).toBe(1); // half a paisa rounds up
    expect(toBase(-1, '0.5', 2, 2)).toBe(-1);
    expect(toBase(123_456_789, '93.9234567891', 2, 2)).toBe(11_595_488_387);
  });
});
