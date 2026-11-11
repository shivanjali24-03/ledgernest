import { describe, expect, it } from 'vitest';
import { complianceDueDates, gstInterest, gstLateFee, tdsDepositDue } from './index.js';

describe('compliance calendar', () => {
  it('lists the month’s GST returns and advance tax, soonest first', () => {
    expect(complianceDueDates('2026-11-10', { gst: true })).toEqual([
      { kind: 'gstr1', from: '2026-10-01', to: '2026-10-31', due: '2026-11-11' },
      { kind: 'gstr3b', from: '2026-10-01', to: '2026-10-31', due: '2026-11-20' },
      { kind: 'gstr1', from: '2026-11-01', to: '2026-11-30', due: '2026-12-11' },
      { kind: 'advance_tax', from: '2026-04-01', to: '2027-03-31', due: '2026-12-15', share: 0.75 },
      { kind: 'gstr3b', from: '2026-11-01', to: '2026-11-30', due: '2026-12-20' },
    ]);
  });

  it('keeps what was missed in the last ten days, and the annual return at the year’s end', () => {
    const items = complianceDueDates('2026-12-24', { gst: true });
    expect(items[0]).toEqual({ kind: 'advance_tax', from: '2026-04-01', to: '2027-03-31', due: '2026-12-15', share: 0.75 });
    expect(items).toContainEqual({ kind: 'gstr9', from: '2025-04-01', to: '2026-03-31', due: '2026-12-31' });
    expect(items).toContainEqual({ kind: 'gstr1', from: '2026-12-01', to: '2026-12-31', due: '2027-01-11' });
  });

  it('shows only advance tax for a business without GST, across the year end', () => {
    expect(complianceDueDates('2027-03-01', { gst: false })).toEqual([{ kind: 'advance_tax', from: '2026-04-01', to: '2027-03-31', due: '2027-03-15', share: 1 }]);
  });

  it('has TDS paid by the 7th of the next month, and by 30 April for March', () => {
    expect(tdsDepositDue('2026-10')).toBe('2026-11-07');
    expect(tdsDepositDue('2026-12')).toBe('2027-01-07');
    expect(tdsDepositDue('2027-03')).toBe('2027-04-30');
  });
});

describe('GST late fees and interest', () => {
  it('charges ₹50 a day, ₹20 for a nil return, capped by turnover', () => {
    const small = { nil: false, turnover: 80_00_000_00 };
    expect(gstLateFee(0, small)).toBe(0);
    expect(gstLateFee(10, small)).toBe(500_00);
    expect(gstLateFee(60, small)).toBe(2_000_00);
    expect(gstLateFee(200, { nil: false, turnover: 3_00_00_000_00 })).toBe(5_000_00);
    expect(gstLateFee(300, { nil: false, turnover: 9_00_00_000_00 })).toBe(10_000_00);
    expect(gstLateFee(10, { nil: true, turnover: 0 })).toBe(200_00);
    expect(gstLateFee(40, { nil: true, turnover: 0 })).toBe(500_00);
  });

  it('adds 18% a year on tax paid late', () => {
    // ₹1,00,000 paid 30 days late: ₹1,479.45
    expect(gstInterest(1_00_000_00, 30)).toBe(1_479_45);
    expect(gstInterest(1_00_000_00, 0)).toBe(0);
    expect(gstInterest(0, 30)).toBe(0);
  });
});

describe('Due dates under the composition scheme', () => {
  it('has CMP-08 for the quarter and GSTR-4 for the year, and no GSTR-1, 3B or 9', () => {
    const october = complianceDueDates('2026-10-10', { gst: true, scheme: 'composition' });
    expect(october.filter((i) => i.kind === 'cmp08').map((i) => [i.from, i.to, i.due])).toEqual([['2026-07-01', '2026-09-30', '2026-10-18']]);
    expect(october.some((i) => ['gstr1', 'gstr3b', 'gstr9'].includes(i.kind))).toBe(false);
    // The year to March 2026: GSTR-4 by 30 April 2026
    const april = complianceDueDates('2026-04-10', { gst: true, scheme: 'composition' });
    expect(april.filter((i) => i.kind === 'gstr4' || i.kind === 'cmp08').map((i) => [i.kind, i.from, i.due])).toEqual([
      ['cmp08', '2026-01-01', '2026-04-18'],
      ['gstr4', '2025-04-01', '2026-04-30'],
    ]);
  });
});
