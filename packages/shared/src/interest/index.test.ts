import { describe, expect, it } from 'vitest';
import { accruedInterest, interestTermsFor, interestTermsText } from './index.js';

const simple18 = { rateBp: 1800, method: 'simple' as const, graceDays: 0 };

describe('Interest on late payments', () => {
  it('works out ₹1,00,000 due 1 June at 18%, ₹40,000 paid 1 July: ₹1,479.45, then ₹29.59 a day', () => {
    const inv = { total: 1_00_000_00, dueDate: '2026-06-01' };
    const paid = [{ date: '2026-07-01', amount: 40_000_00 }];
    const july1 = accruedInterest(simple18, inv, paid, '2026-07-01');
    expect(july1.interest).toBe(1_479_45);
    expect(july1.perDay).toBe(29_59);
    // Ten more days on ₹60,000
    const july11 = accruedInterest(simple18, inv, paid, '2026-07-11');
    expect(july11.interest).toBe(1_479_45 + 295_89);
    expect(july11.periods).toEqual([
      { from: '2026-06-01', to: '2026-06-30', days: 30, principal: 1_00_000_00, interest: 1_479_45 },
      { from: '2026-07-01', to: '2026-07-10', days: 10, principal: 60_000_00, interest: 295_89 },
    ]);
    expect(july11.daysLate).toBe(40);
  });

  it('charges nothing before the due date, or when paid within the grace days', () => {
    const inv = { total: 10_000_00, dueDate: '2026-06-01' };
    expect(accruedInterest(simple18, inv, [], '2026-06-01').interest).toBe(0);
    const grace = { ...simple18, graceDays: 7 };
    expect(accruedInterest(grace, inv, [{ date: '2026-06-06', amount: 10_000_00 }], '2026-07-01')).toMatchObject({ interest: 0, daysLate: 5, inGrace: false });
    expect(accruedInterest(grace, inv, [], '2026-06-05')).toMatchObject({ interest: 0, inGrace: true });
    // Past the grace, interest runs from the due date
    expect(accruedInterest(grace, inv, [], '2026-06-11').interest).toBe(Math.round((10_000_00 * 0.18 * 10) / 365));
  });

  it('stops once paid in full, and counts credit notes like payments', () => {
    const inv = { total: 36_500_00, dueDate: '2026-01-01' };
    const r = accruedInterest(simple18, inv, [{ date: '2026-01-11', amount: 16_500_00 }, { date: '2026-01-21', amount: 20_000_00 }], '2026-12-31');
    // 10 days on 36,500 + 10 days on 20,000 at 18%
    expect(r.interest).toBe(180_00 + 98_63);
    expect(r.perDay).toBe(0);
    expect(r.daysLate).toBe(20);
  });

  it('compounds monthly when asked, adding each month’s interest to what bears interest', () => {
    const inv = { total: 1_00_000_00, dueDate: '2026-01-31' };
    const monthly = { ...simple18, method: 'monthly' as const };
    const simple = accruedInterest(simple18, inv, [], '2026-04-30').interest;
    const compound = accruedInterest(monthly, inv, [], '2026-04-30').interest;
    expect(compound).toBeGreaterThan(simple);
    // Month ends follow the due date, keeping to the last day of shorter months
    expect(accruedInterest(monthly, inv, [], '2026-04-30').periods.map((p) => p.from)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('takes the invoice’s terms, else the customer’s, else the organisation’s; 0 turns it off', () => {
    const org = { rateBp: 1800, method: 'simple' as const, graceDays: 3 };
    expect(interestTermsFor(org, null)).toEqual({ rateBp: 1800, method: 'simple', graceDays: 3 });
    expect(interestTermsFor(org, { rateBp: 2400 })?.rateBp).toBe(2400);
    expect(interestTermsFor(org, { rateBp: 0 })).toBeNull();
    expect(interestTermsFor(org, { rateBp: null }, { rateBp: 1200 })?.rateBp).toBe(1200);
    expect(interestTermsFor({ rateBp: null }, null)).toBeNull();
    expect(interestTermsText({ rateBp: 1800, method: 'simple', graceDays: 7 })).toBe('Interest at 18% a year is charged on any amount unpaid after the due date (no interest if paid within 7 days of it).');
    expect(interestTermsText({ rateBp: 1250, method: 'monthly', graceDays: 0 })).toBe('Interest at 12.50% a year, compounded monthly, is charged on any amount unpaid after the due date.');
  });
});
