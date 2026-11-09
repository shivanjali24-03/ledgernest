import { describe, expect, it } from 'vitest';
import { dueDateFor, formatQuantity, invoiceAmounts, invoiceDraftSchema, invoiceNumber, invoiceState, lineNet, parseQuantity } from './index.js';

describe('invoices', () => {
  it('reads quantities with up to 4 decimals', () => {
    expect(parseQuantity('2.5')).toBe(25_000n);
    expect(formatQuantity(25_000n)).toBe('2.5');
    for (const bad of ['0', '-1', '1.23456', 'x']) expect(parseQuantity(bad)).toBeNull();
  });

  it('works out a line net of discount, rounding half up', () => {
    expect(lineNet('3', 250_000, 0)).toBe(750_000); // 3 hours at ₹2,500
    expect(lineNet('2.5', 250_000, 100_000)).toBe(562_500); // 10% off
    expect(lineNet('0.3333', 100, 0)).toBe(33);
  });

  it('adds tax per line, each component rounded on its own', () => {
    const gst18 = [
      { rateId: 'c', ratePpm: 90_000 },
      { rateId: 's', ratePpm: 90_000 },
    ];
    const a = invoiceAmounts([
      { quantity: '3', unitPrice: 250_000, discountPpm: 0, rates: gst18 },
      { quantity: '1', unitPrice: 55, discountPpm: 0, rates: gst18 },
      { quantity: '1', unitPrice: 10_000, discountPpm: 0, rates: [] },
    ]);
    expect(a.lines.map((l) => [l.net, l.tax])).toEqual([
      [750_000, 135_000],
      [55, 10],
      [10_000, 0],
    ]);
    expect([a.subtotal, a.tax, a.total]).toEqual([760_055, 135_010, 895_065]);
  });

  it('validates a draft, its lines and dates', () => {
    const id = '7f1d3c1e-8a0b-4c2d-9e3f-1a2b3c4d5e6f';
    const d = invoiceDraftSchema.parse({ contactId: id, issueDate: '2026-11-09', lines: [{ description: 'Dev', quantity: 3, unitPrice: 250_000, discount: '10' }] });
    expect(d.lines[0]).toMatchObject({ quantity: '3', discount: 100_000, taxGroupId: null });
    expect(invoiceDraftSchema.safeParse({ contactId: id, issueDate: '2026-11-09', lines: [] }).success).toBe(false);
    expect(invoiceDraftSchema.safeParse({ contactId: id, issueDate: '2026-11-09', dueDate: '2026-11-01', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).success).toBe(false);
  });

  it('numbers, due dates and states', () => {
    expect(invoiceNumber('FY 2026–27', 7)).toBe('INV/2026-27/0007');
    expect(dueDateFor('2026-11-09', 30)).toBe('2026-12-09');
    const issued = { status: 'issued' as const, total: 1000, amountPaid: 0, dueDate: '2026-11-30' };
    expect(invoiceState(issued, '2026-11-09')).toBe('issued');
    expect(invoiceState(issued, '2026-12-01')).toBe('overdue');
    expect(invoiceState({ ...issued, amountPaid: 400 }, '2026-11-09')).toBe('partly_paid');
    expect(invoiceState({ ...issued, amountPaid: 1000 }, '2026-12-31')).toBe('paid');
    expect(invoiceState({ ...issued, status: 'void' }, '2026-12-31')).toBe('void');
  });
});
