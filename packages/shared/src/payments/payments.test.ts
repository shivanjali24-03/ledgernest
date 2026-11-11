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

describe('payment modes', () => {
  it('checks a cheque’s number and age, a UTR and a UPI reference', async () => {
    const { paymentModeProblem } = await import('./index.js');
    const base = { instrumentNo: null, instrumentDate: null, date: '2026-10-05' };
    expect(paymentModeProblem({ ...base, mode: 'cheque', instrumentNo: '12345' })?.field).toBe('instrumentNo');
    expect(paymentModeProblem({ ...base, mode: 'cheque', instrumentNo: '123456', instrumentDate: '2026-09-01' })).toBeNull();
    expect(paymentModeProblem({ ...base, mode: 'cheque', instrumentNo: '123456', instrumentDate: '2026-06-01' })?.message).toMatch(/three months/);
    expect(paymentModeProblem({ ...base, mode: 'neft', instrumentNo: 'HDFCN52026101012345' })).toBeNull();
    expect(paymentModeProblem({ ...base, mode: 'rtgs', instrumentNo: 'X1' })?.field).toBe('instrumentNo');
    expect(paymentModeProblem({ ...base, mode: 'upi', instrumentNo: '628310012345' })).toBeNull();
    expect(paymentModeProblem({ ...base, mode: 'cash' })).toBeNull();
  });

  it('describes the mode for receipts and advice', async () => {
    const { paymentModeText } = await import('./index.js');
    expect(paymentModeText({ mode: 'cheque', instrumentNo: '123456', instrumentDate: '2026-10-05', drawnOn: 'HDFC Bank' })).toBe('Cheque 123456 dated 05/10/2026 on HDFC Bank');
    expect(paymentModeText({ mode: 'neft', instrumentNo: 'HDFCN52026101012345', instrumentDate: null, drawnOn: null })).toBe('NEFT, UTR HDFCN52026101012345');
    expect(paymentModeText({ mode: null, instrumentNo: null, instrumentDate: null, drawnOn: null })).toBeNull();
  });
});

describe('cash limits', () => {
  it('flags ₹2 lakh or more received in cash from one person in a day, or for one invoice (s.269ST)', async () => {
    const { cashLimitBreach } = await import('./index.js');
    expect(cashLimitBreach({ kind: 'receipt', amount: 1_99_999_00, sameDay: 0 })).toBeNull();
    expect(cashLimitBreach({ kind: 'receipt', amount: 1_00_000_00, sameDay: 1_00_000_00 })).toMatchObject({ section: '269ST', basis: 'day', total: 2_00_000_00 });
    expect(cashLimitBreach({ kind: 'receipt', amount: 50_000_00, sameDay: 0, perInvoice: [2_10_000_00] })).toMatchObject({ basis: 'invoice' });
  });

  it('flags cash paid to one person above ₹10,000 in a day, ₹35,000 to a transporter (s.40A(3))', async () => {
    const { cashLimitBreach } = await import('./index.js');
    expect(cashLimitBreach({ kind: 'payment', amount: 10_000_00, sameDay: 0 })).toBeNull();
    expect(cashLimitBreach({ kind: 'payment', amount: 6_000_00, sameDay: 5_000_00 })).toMatchObject({ section: '40A(3)', limit: 10_000_00 });
    expect(cashLimitBreach({ kind: 'payment', amount: 30_000_00, sameDay: 0, transporter: true })).toBeNull();
  });
});
