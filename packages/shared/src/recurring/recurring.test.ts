import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrenceDate, recurringSchema } from './index.js';

describe('recurring schedules', () => {
  it('counts every date from the start, so month ends never drift', () => {
    expect([0, 1, 2, 3].map((n) => occurrenceDate('2026-01-31', 'monthly', 1, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDate('2027-11-30', 'quarterly', 1, 1)).toBe('2028-02-29');
    expect(occurrenceDate('2026-12-29', 'weekly', 2, 1)).toBe('2027-01-12');
    expect(occurrenceDate('2028-02-29', 'yearly', 1, 1)).toBe('2029-02-28');
    expect(occurrenceDate('2026-05-15', 'monthly', 2, 4)).toBe('2027-01-15');
  });
  it('ends after a count or past an end date', () => {
    const s = { startDate: '2026-04-01', frequency: 'monthly' as const, interval: 1, endDate: '2026-06-15', maxCount: null };
    expect(nextOccurrence(s, 2)).toBe('2026-06-01');
    expect(nextOccurrence(s, 3)).toBeNull();
    expect(nextOccurrence({ ...s, endDate: null, maxCount: 3 }, 3)).toBeNull();
    expect(nextOccurrence({ ...s, endDate: null, maxCount: 3 }, 2)).toBe('2026-06-01');
  });
  it('validates the schedule', () => {
    const base = { name: 'Retainer', contactId: crypto.randomUUID(), frequency: 'monthly', startDate: '2026-04-01', lines: [{ description: 'Retainer', quantity: 1, unitPrice: 100 }] };
    expect(recurringSchema.parse(base)).toMatchObject({ interval: 1, autoIssue: false, endDate: null, maxCount: null });
    expect(recurringSchema.safeParse({ ...base, endDate: '2026-03-01' }).success).toBe(false);
    expect(recurringSchema.safeParse({ ...base, frequency: 'daily' }).success).toBe(false);
  });
});
