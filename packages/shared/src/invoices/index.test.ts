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

  it('lists the serial numbers of the units sold under the line, three to a row', () => {
    const rows = invoiceRows({ currency: 'INR', subtotal: 0, total: 0, amountPaid: 0, balance: 0, taxBreakdown: [], lines: [{ description: 'Phone', quantity: '4', unitPrice: 0, discount: 0, amount: 0, taxAmount: 0, item: null, serials: ['IMEI1', 'IMEI2', 'IMEI3', 'IMEI4'] }] }, 2);
    expect(rows.slice(2, 4).map((r) => r[0])).toEqual(['   S/N IMEI1, IMEI2, IMEI3', '   S/N IMEI4']);
  });

  it('lists the batches a line of goods came from under it', () => {
    const rows = invoiceRows({ currency: 'INR', subtotal: 100_00, total: 112_00, amountPaid: 0, balance: 112_00, taxBreakdown: [], lines: [{ description: 'Paracetamol 500mg', quantity: '10', unitPrice: 10_00, discount: 0, amount: 100_00, taxAmount: 12_00, item: { hsnSac: '3004' }, batches: [{ batchNo: 'PX1', mfgDate: '2026-01-10', expiryDate: '2027-12-31', quantity: '4' }, { batchNo: 'PX2', mfgDate: null, expiryDate: '2028-06-30', quantity: '6' }] }] }, 2);
    expect(rows.slice(1, 4)).toEqual([
      ['Paracetamol 500mg', '3004', '10', '10.00', '', '100.00', '12.00'],
      ['   Batch PX1 · Mfg 01/2026 · Exp 12/2027', '', '4', '', '', '', ''],
      ['   Batch PX2 · Exp 06/2028', '', '6', '', '', '', ''],
    ]);
  });
});

describe('Dispatch details', () => {
  it('cleans the vehicle number and prints only what was given', async () => {
    const { dispatchSchema, dispatchLines } = await import('./index.js');
    const d = dispatchSchema.parse({ buyerOrderNo: 'PO-77', buyerOrderDate: '2026-05-02', vehicleNo: 'mh 12-ab 1234', dispatchedThrough: 'VRL Logistics', deliveryNote: '' });
    expect(d).toMatchObject({ vehicleNo: 'MH12AB1234', deliveryNote: null });
    expect(dispatchLines(d)).toEqual(["Buyer's order: PO-77 dated 2026-05-02", 'Dispatched through: VRL Logistics', 'Vehicle: MH12AB1234']);
    expect(dispatchSchema.safeParse({ vehicleNo: '12' }).success).toBe(false);
  });
});

describe('Rounding the total', () => {
  it('rounds to the nearest rupee, half up, keeping the difference', async () => {
    const { invoiceAmounts } = await import('./index.js');
    const line = (unitPrice: number) => ({ quantity: '1', unitPrice, discountPpm: 0, rates: [{ rateId: 'g', ratePpm: 180_000 }] });
    // 1,000.30 + 18% = 1,180.354 → 1,180.35 tax total; rounded to 1,180
    expect(invoiceAmounts([line(1_000_30)], { roundTo: 100 })).toMatchObject({ subtotal: 1_000_30, tax: 180_05, roundOff: -35, total: 1_180_00 });
    expect(invoiceAmounts([line(1_000_45)], { roundTo: 100 })).toMatchObject({ roundOff: 47, total: 1_181_00 });
    expect(invoiceAmounts([line(1_000_30)])).toMatchObject({ roundOff: 0, total: 1_180_35 });
  });
});
