import { describe, expect, it } from 'vitest';
import { invoiceRows, reminderDue } from './index.js';

describe('reminderDue', () => {
  const policy = { enabled: true, firstAfterDays: 3, repeatEveryDays: 7, maxReminders: 2 };
  const inv = { status: 'issued', balance: 100, dueDate: '2026-11-01', reminders: 0, lastRemindedAt: null };
  it('waits for the first days after the due date, then repeats on the spacing, up to the limit', () => {
    expect(reminderDue(inv, policy, '2026-11-03')).toBe(false);
    expect(reminderDue(inv, policy, '2026-11-04')).toBe(true);
    const once = { ...inv, reminders: 1, lastRemindedAt: '2026-11-04T05:00:00.000Z' };
    expect(reminderDue(once, policy, '2026-11-10')).toBe(false);
    expect(reminderDue(once, policy, '2026-11-11')).toBe(true);
    expect(reminderDue({ ...once, reminders: 2 }, policy, '2026-12-30')).toBe(false);
  });
  it('never reminds when off, paid, not issued, or not yet overdue', () => {
    expect(reminderDue(inv, { ...policy, enabled: false }, '2026-12-01')).toBe(false);
    expect(reminderDue({ ...inv, balance: 0 }, policy, '2026-12-01')).toBe(false);
    expect(reminderDue({ ...inv, status: 'void' }, policy, '2026-12-01')).toBe(false);
    // "0 days after" still means once it's overdue, not on the due date
    expect(reminderDue(inv, { ...policy, firstAfterDays: 0 }, '2026-11-01')).toBe(false);
    expect(reminderDue(inv, { ...policy, firstAfterDays: 0 }, '2026-11-02')).toBe(true);
  });
});

describe('invoiceRows', () => {
  it('lays out lines, tax by rate and totals, with the balance once something is paid', () => {
    const rows = invoiceRows({ currency: 'INR', subtotal: 1_000_000, total: 1_180_000, amountPaid: 180_000, balance: 1_000_000, taxBreakdown: [{ name: 'CGST 9%', amount: 90_000 }, { name: 'SGST 9%', amount: 90_000 }], lines: [{ description: 'Development', quantity: '4', unitPrice: 250_000, discount: 0, amount: 1_000_000, taxAmount: 180_000, item: { hsnSac: '998314' } }] }, 2);
    expect(rows[1]).toEqual(['Development', '998314', '4', '2500.00', '', '10000.00', '1800.00']);
    expect(rows.map((r) => r[4])).toContain('CGST 9%');
    expect(rows.at(-1)).toEqual(['', '', '', '', 'Balance due', '', '10000.00']);
  });
});
