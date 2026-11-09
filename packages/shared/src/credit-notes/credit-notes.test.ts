import { describe, expect, it } from 'vitest';
import { creditNoteNumber, creditNoteSchema, creditRefundSchema } from './index.js';

describe('credit notes', () => {
  it('numbers like invoices, with its own prefix', () => {
    expect(creditNoteNumber('FY 2026–27', 7)).toBe('CN/2026-27/0007');
  });
  it('needs a line with a quantity above zero', () => {
    const base = { invoiceId: crypto.randomUUID(), date: '2026-05-10' };
    expect(creditNoteSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(creditNoteSchema.safeParse({ ...base, lines: [{ invoiceLineId: crypto.randomUUID(), quantity: '0' }] }).success).toBe(false);
    expect(creditNoteSchema.safeParse({ ...base, lines: [{ invoiceLineId: crypto.randomUUID(), quantity: '1.5' }] }).data).toMatchObject({ reason: null });
  });
  it('refunds a positive amount', () => {
    expect(creditRefundSchema.safeParse({ date: '2026-05-10', bankAccountId: crypto.randomUUID(), amount: 0 }).success).toBe(false);
  });
});
