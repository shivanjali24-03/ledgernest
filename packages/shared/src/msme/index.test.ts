import { describe, expect, it } from 'vitest';
import { msmeCovered, msmeDeadline, msmeReport, type MsmeBillInput } from './index.js';

const FY = { from: '2026-04-01', to: '2027-03-31' };
const vendor = { id: 'v1', name: 'Sharma Fabricators', category: 'micro' as const, udyamNumber: 'UDYAM-MH-26-0012345' };
const bill = (over: Partial<MsmeBillInput>): MsmeBillInput => ({ id: over.number ?? 'b', number: 'BILL-1', vendor, billDate: '2026-06-01', dueDate: '2026-07-01', total: 1_18_000_00, subtotal: 1_00_000_00, settlements: [], ...over });

describe('MSME 45-day rule', () => {
  it('gives the agreed date, at most 45 days from the bill', () => {
    expect(msmeDeadline('2026-06-01', '2026-07-01')).toBe('2026-07-01');
    expect(msmeDeadline('2026-06-01', '2026-08-30')).toBe('2026-07-16');
    expect(msmeDeadline('2026-06-01', null)).toBe('2026-06-16');
    expect(['micro', 'small', 'medium', null].map((c) => msmeCovered(c as never))).toEqual([true, true, false, false]);
  });

  it('shows each bill’s state today, worst first', () => {
    const r = msmeReport(
      [
        bill({ number: 'B-ontime', settlements: [{ date: '2026-06-28', amount: 1_18_000_00 }] }),
        bill({ number: 'B-late', settlements: [{ date: '2026-07-20', amount: 1_18_000_00 }] }),
        bill({ number: 'B-overdue', settlements: [{ date: '2026-06-20', amount: 18_000_00 }] }),
        bill({ number: 'B-soon', billDate: '2026-07-10', dueDate: '2026-08-09' }),
        bill({ number: 'B-open', billDate: '2026-07-25', dueDate: '2026-08-24' }),
        bill({ number: 'B-medium', vendor: { ...vendor, category: 'medium' } }),
      ],
      '2026-08-04',
      FY,
    );
    expect(r.bills.map((b) => [b.number, b.state, b.daysLeft])).toEqual([
      ['B-overdue', 'overdue', -34],
      ['B-soon', 'due_soon', 5],
      ['B-open', 'open', 20],
      ['B-late', 'paid_late', -34],
      ['B-ontime', 'paid_on_time', -34],
    ]);
    expect(r.totals).toMatchObject({ overdue: 1_00_000_00, dueSoon: 1_18_000_00, paidLate: 1_18_000_00 });
  });

  it('takes out of the year what is still owed past the deadline, as taxable value', () => {
    // ₹1,00,000 of ₹1,18,000 still owed past 1 July: the taxable share, ₹84,746, is at risk
    const owed = msmeReport([bill({ settlements: [{ date: '2026-06-20', amount: 18_000_00 }] })], '2026-08-04', FY);
    expect(owed.bills[0]!.disallowed).toBe(84_745_76);
    // Paid late but within the year: allowed
    expect(msmeReport([bill({ settlements: [{ date: '2026-07-20', amount: 1_18_000_00 }] })], '2026-08-04', FY).totals.disallowed).toBe(0);
    // Not yet past the deadline: still time
    expect(msmeReport([bill({})], '2026-06-15', FY).totals.disallowed).toBe(0);
    // Billed in March, deadline in May of the next year, paid by then: allowed; not paid: taken out
    const march = bill({ billDate: '2027-03-20', dueDate: '2027-05-04' });
    expect(msmeReport([{ ...march, settlements: [{ date: '2027-04-30', amount: 1_18_000_00 }] }], '2027-05-10', FY).totals.disallowed).toBe(0);
    expect(msmeReport([march], '2027-05-10', FY).totals.disallowed).toBe(1_00_000_00);
  });

  it('carries bills still owed from an earlier year, but nothing from it is taken out of this one', () => {
    const r = msmeReport([bill({ billDate: '2026-02-01', dueDate: '2026-03-01' }), bill({ number: 'old-paid', billDate: '2026-02-01', dueDate: '2026-03-01', settlements: [{ date: '2026-02-20', amount: 1_18_000_00 }] })], '2026-08-04', FY);
    expect(r.bills.map((b) => [b.number, b.state, b.disallowed])).toEqual([['BILL-1', 'overdue', 0]]);
  });
});
