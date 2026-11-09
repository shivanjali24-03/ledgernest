import { describe, expect, it } from 'vitest';
import { fiscalYearName, fiscalYearOf, fiscalYearSpan, isoDaySchema, todayIn } from './index.js';

describe('financial years', () => {
  it('splits an April year into 12 calendar months, across the year boundary', () => {
    const y = fiscalYearSpan(2026, 4);
    expect([y.startDate, y.endDate]).toEqual(['2026-04-01', '2027-03-31']);
    expect(y.periods[10]).toEqual({ number: 11, startDate: '2027-02-01', endDate: '2027-02-28' });
    expect(fiscalYearSpan(2028, 1).periods[1]!.endDate).toBe('2028-02-29');
  });

  it('names years and finds the year a day belongs to', () => {
    expect(fiscalYearName(2026, 4)).toBe('FY 2026–27');
    expect(fiscalYearName(2026, 1)).toBe('FY 2026');
    expect(fiscalYearOf('2027-03-31', 4)).toBe(2026);
    expect(fiscalYearOf('2027-04-01', 4)).toBe(2027);
  });

  it("knows today's date in a time zone and validates real days", () => {
    // 20:00 UTC on 31 March is already 1 April in India
    expect(todayIn('Asia/Kolkata', new Date('2027-03-31T20:00:00Z'))).toBe('2027-04-01');
    expect(todayIn('America/New_York', new Date('2027-03-31T20:00:00Z'))).toBe('2027-03-31');
    expect(isoDaySchema.safeParse('2026-02-29').success).toBe(false);
    expect(isoDaySchema.safeParse('2028-02-29').success).toBe(true);
  });
});
