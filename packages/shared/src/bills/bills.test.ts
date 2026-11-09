import { describe, expect, it } from 'vitest';
import { billDraftSchema, billNumber, billState } from './index.js';

describe('bills', () => {
  const id = '7f1d3c1e-8a0b-4c2d-9e3f-1a2b3c4d5e6f';
  it('validates a draft with the vendor’s own number', () => {
    expect(billDraftSchema.parse({ contactId: id, vendorReference: ' SOS/887 ', billDate: '2026-11-01', lines: [{ description: 'Paper', quantity: 10, unitPrice: 28_000 }] })).toMatchObject({ vendorReference: 'SOS/887', dueDate: null });
    expect(billDraftSchema.safeParse({ contactId: id, billDate: '2026-11-01', dueDate: '2026-10-01', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).success).toBe(false);
  });
  it('numbers and states', () => {
    expect(billNumber('FY 2026–27', 4)).toBe('BILL/2026-27/0004');
    const open = { status: 'open' as const, total: 100, amountPaid: 0, dueDate: '2026-11-30' };
    expect(billState(open, '2026-11-09')).toBe('open');
    expect(billState(open, '2026-12-01')).toBe('overdue');
    expect(billState({ ...open, amountPaid: 100 }, '2026-12-01')).toBe('paid');
  });
});
