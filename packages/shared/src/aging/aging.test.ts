import { describe, expect, it } from 'vitest';
import { agingBucket, daysBetween } from './index.js';

describe('aging', () => {
  it('counts days across months and years', () => {
    expect(daysBetween('2026-01-31', '2026-03-01')).toBe(29);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-05-10', '2026-05-01')).toBe(-9);
  });
  it('buckets by days past due, edges included in the lower bucket', () => {
    const asOf = '2026-06-30';
    expect(agingBucket('2026-07-15', asOf)).toBe('current');
    expect(agingBucket('2026-06-30', asOf)).toBe('current');
    expect(agingBucket('2026-06-29', asOf)).toBe('d1_30');
    expect(agingBucket('2026-05-31', asOf)).toBe('d1_30');
    expect(agingBucket('2026-05-30', asOf)).toBe('d31_60');
    expect(agingBucket('2026-04-01', asOf)).toBe('d61_90');
    expect(agingBucket('2026-03-31', asOf)).toBe('over_90');
  });
});
