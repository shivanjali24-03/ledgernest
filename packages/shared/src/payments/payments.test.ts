import { describe, expect, it } from 'vitest';
import { allocateOldestFirst, paymentNumber, receiptSchema } from './index.js';

describe('receipts', () => {
  const id = '7f1d3c1e-8a0b-4c2d-9e3f-1a2b3c4d5e6f';
  it('allocates no more than was received, each invoice once', () => {
    const base = { contactId: id, date: '2026-11-09', bankAccountId: id, amount: 1000 };
    expect(receiptSchema.parse(base)).toMatchObject({ allocations: [], rate: null });
    expect(receiptSchema.safeParse({ ...base, allocations: [{ invoiceId: id, amount: 1001 }] }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...base, allocations: [{ invoiceId: id, amount: 400 }, { invoiceId: id, amount: 400 }] }).success).toBe(false);
  });
  it('suggests paying the oldest invoices first', () => {
    const open = [
      { id: 'b', dueDate: '2026-11-20', balance: 500 },
      { id: 'a', dueDate: '2026-10-20', balance: 300 },
    ];
    expect(allocateOldestFirst(600, open)).toEqual([
      { invoiceId: 'a', amount: 300 },
      { invoiceId: 'b', amount: 300 },
    ]);
    expect(allocateOldestFirst(100, open)).toEqual([{ invoiceId: 'a', amount: 100 }]);
  });
  it('numbers receipts and payments', () => {
    expect(paymentNumber('receipt', 'FY 2026–27', 3)).toBe('RCT/2026-27/0003');
    expect(paymentNumber('payment', 'FY 2026–27', 12)).toBe('PAY/2026-27/0012');
  });
});
