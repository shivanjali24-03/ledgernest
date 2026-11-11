import { describe, expect, it } from 'vitest';
import { goodsReceiptSchema, grnNumber, poLineOpen, poNumber, purchaseOrderDraftSchema } from './index.js';

describe('purchase orders', () => {
  it('numbers orders and receipts', () => {
    expect(poNumber(7)).toBe('PO-0007');
    expect(grnNumber(12)).toBe('GRN-0012');
  });

  it('works out what is left to receive and to bill on a line', () => {
    expect(poLineOpen({ quantity: '10', received: '4', billed: '0' })).toEqual({ toReceive: 60_000n, toBill: 40_000n });
    expect(poLineOpen({ quantity: '10', received: '10', billed: '10' })).toEqual({ toReceive: 0n, toBill: 0n });
  });

  it('checks the dates, and that a receipt says what came', () => {
    const line = { description: 'Steel rods', quantity: '10', unitPrice: 500_00, accountId: null, taxGroupId: null };
    expect(purchaseOrderDraftSchema.safeParse({ contactId: crypto.randomUUID(), orderDate: '2026-06-10', expectedDate: '2026-06-01', lines: [line] }).error!.issues[0]!.path).toEqual(['expectedDate']);
    expect(goodsReceiptSchema.safeParse({ date: '2026-06-12', lines: [{ lineId: crypto.randomUUID(), quantity: '0' }] }).success).toBe(false);
  });
});
