import { describe, expect, it } from 'vitest';
import { nextReportRun, reportPeriod } from './index.js';

describe('scheduled reports', () => {
  it('finds the next weekday or day of the month, after the moment given', () => {
    // Tuesday 10 November 2026, 05:00 UTC
    const now = new Date('2026-11-10T05:00:00Z');
    expect(nextReportRun(now, 'weekly', 1).toISOString()).toBe('2026-11-16T04:00:00.000Z');
    expect(nextReportRun(now, 'weekly', 3).toISOString()).toBe('2026-11-11T04:00:00.000Z');
    expect(nextReportRun(now, 'weekly', 2).toISOString()).toBe('2026-11-17T04:00:00.000Z');
    expect(nextReportRun(new Date('2026-11-10T03:00:00Z'), 'weekly', 2).toISOString()).toBe('2026-11-10T04:00:00.000Z');
    expect(nextReportRun(now, 'monthly', 1).toISOString()).toBe('2026-12-01T04:00:00.000Z');
    expect(nextReportRun(now, 'monthly', 28).toISOString()).toBe('2026-11-28T04:00:00.000Z');
  });
  it('covers the week or month just ended', () => {
    expect(reportPeriod('2026-11-16', 'weekly')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(reportPeriod('2026-12-01', 'monthly')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(reportPeriod('2026-03-05', 'monthly')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
