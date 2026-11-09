import { describe, expect, it } from 'vitest';
import { itemCreateSchema, itemUpdateSchema } from './index.js';

describe('items', () => {
  it('defaults to a service, tidying the SKU and checking the HSN/SAC code', () => {
    expect(itemCreateSchema.parse({ name: 'Consulting hour', sku: ' cons-01 ', hsnSac: '998314', salePrice: 250_000 })).toMatchObject({ kind: 'service', sku: 'CONS-01', hsnSac: '998314', salePrice: 250_000, purchasePrice: null });
    expect(itemCreateSchema.safeParse({ name: 'Laptop', hsnSac: '84713' }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: 'Laptop', salePrice: -1 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: 'Laptop', salePrice: 1.5 }).success).toBe(false);
  });
  it('updates only what is sent', () => {
    expect(itemUpdateSchema.parse({ salePrice: null })).toEqual({ salePrice: null });
    expect(itemUpdateSchema.safeParse({}).success).toBe(false);
    expect(itemUpdateSchema.safeParse({ stock: 4 }).success).toBe(false);
  });
});
