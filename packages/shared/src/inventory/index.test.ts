import { describe, expect, it } from 'vitest';
import { averageUnitCost, costOfQuantity } from './index.js';

describe('average cost', () => {
  it('takes part of the stock at its average cost, and all of it at its whole value', () => {
    // 3 units worth ₹100.00 in all: one unit is ₹33.33, two ₹66.67, three exactly ₹100.00
    expect(costOfQuantity(30_000n, 10_000n, 10_000n)).toBe(3_333n);
    expect(costOfQuantity(30_000n, 10_000n, 20_000n)).toBe(6_667n);
    expect(costOfQuantity(30_000n, 10_000n, 30_000n)).toBe(10_000n);
    expect(costOfQuantity(0n, 0n, 10_000n)).toBe(0n);
    expect(averageUnitCost(30_000n, 10_000n)).toBe(3_333);
    expect(averageUnitCost(0n, 0n)).toBeNull();
  });
});
