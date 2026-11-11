import { describe, expect, it } from 'vitest';
import { itcBillStatus, itcPaymentDeadline, itcRule37ForPeriod, shareOf } from './index.js';

const credit = { igst: 0, cgst: 9_000_00, sgst: 9_000_00, cess: 0 };
// ₹1,00,000 + ₹18,000 GST, invoiced 1 April 2026
const bill = (settlements: { date: string; amount: number }[] = []) => ({ id: 'b', invoiceDate: '2026-04-01', total: 1_18_000_00, credit, settlements });

describe('Rule 37: paying suppliers within 180 days', () => {
  it('counts 180 days from the supplier’s invoice', () => {
    expect(itcPaymentDeadline('2026-04-01')).toBe('2026-09-28');
  });

  it('shares credit in proportion to what’s unpaid', () => {
    expect(shareOf(credit, 59_000_00, 1_18_000_00)).toEqual({ igst: 0, cgst: 4_500_00, sgst: 4_500_00, cess: 0 });
  });

  it('warns in the last 30 days, then reverses what’s unpaid, then takes it back once paid', () => {
    expect(itcBillStatus(bill(), '2026-08-01').state).toBe('ok');
    expect(itcBillStatus(bill(), '2026-09-10')).toMatchObject({ state: 'due_soon', daysLeft: 18 });
    // Half paid on time: half the credit is reversed
    const half = bill([{ date: '2026-06-01', amount: 59_000_00 }]);
    expect(itcBillStatus(half, '2026-10-05')).toMatchObject({ state: 'reverse', reversed: { cgst: 4_500_00, sgst: 4_500_00 } });
    const paid = bill([
      { date: '2026-06-01', amount: 59_000_00 },
      { date: '2026-11-15', amount: 59_000_00 },
    ]);
    expect(itcBillStatus(paid, '2026-11-20')).toMatchObject({ state: 'reclaim', reclaimable: { cgst: 4_500_00, sgst: 4_500_00 } });
    expect(itcBillStatus(bill([{ date: '2026-09-28', amount: 1_18_000_00 }]), '2026-10-05').state).toBe('ok');
  });

  it('reverses in the return for the month the 180 days end, and reclaims in the month it’s paid', () => {
    const paid = bill([{ date: '2026-11-15', amount: 1_18_000_00 }]);
    expect(itcRule37ForPeriod([paid], '2026-09-01', '2026-09-30')).toEqual({ reverse: credit, reclaim: { igst: 0, cgst: 0, sgst: 0, cess: 0 } });
    expect(itcRule37ForPeriod([paid], '2026-10-01', '2026-10-31').reverse.cgst).toBe(0);
    expect(itcRule37ForPeriod([paid], '2026-11-01', '2026-11-30')).toEqual({ reverse: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, reclaim: credit });
  });
});
