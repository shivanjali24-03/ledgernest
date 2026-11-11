import { describe, expect, it } from 'vitest';
import { stockTransferSchema, transferNumber, warehouseCodeFrom, warehouseSchema } from './index.js';

describe('warehouses', () => {
  it('makes a code from the name, and checks one given', () => {
    expect(warehouseCodeFrom('Bhiwandi godown')).toBe('BHIW');
    expect(warehouseCodeFrom('गोदाम')).toBe('WH');
    expect(warehouseSchema.parse({ name: 'Pune shop', code: 'pune-1' }).code).toBe('PUNE-1');
    expect(warehouseSchema.safeParse({ name: 'X', code: 'NOT A CODE' }).success).toBe(false);
  });

  it('moves goods between two different places', () => {
    const a = '0d8c1f0e-6c1a-4b7a-9f1e-1a2b3c4d5e6f';
    const line = { itemId: a, quantity: '2' };
    expect(stockTransferSchema.safeParse({ date: '2026-06-01', fromWarehouseId: a, toWarehouseId: a, lines: [line] }).success).toBe(false);
    expect(transferNumber(7)).toBe('TR-0007');
  });
});
