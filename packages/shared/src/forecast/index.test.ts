import { describe, expect, it } from 'vitest';
import { addDays, buildCashForecast, cashForecastQuerySchema, expectedDate, usualLateness, type ForecastItem } from './index.js';

const contact = { id: 'c1', name: 'Kumar Logistics' };
const item = (over: Partial<ForecastItem>): ForecastItem => ({ kind: 'invoice', id: crypto.randomUUID(), label: 'INV/1', contact, dueDate: '2026-11-10', amount: 0, ...over });

describe('cash forecast', () => {
  it('learns how late a customer usually pays, early counting as on time', () => {
    expect(usualLateness([])).toBeNull();
    expect(usualLateness([{ dueDate: '2026-06-01', paidOn: '2026-06-20' }])).toBeNull();
    expect(
      usualLateness([
        { dueDate: '2026-06-01', paidOn: '2026-06-11' },
        { dueDate: '2026-07-01', paidOn: '2026-07-21' },
        { dueDate: '2026-08-01', paidOn: '2026-07-25' },
      ]),
    ).toBe(10);
    expect(usualLateness([{ dueDate: '2026-01-01', paidOn: '2026-12-01' }, { dueDate: '2026-01-01', paidOn: '2026-12-01' }])).toBe(90);
  });

  it('expects money on the due date plus the usual lateness, never before today', () => {
    expect(expectedDate({ dueDate: '2026-11-20', lateDays: 12 }, '2026-11-10')).toBe('2026-12-02');
    expect(expectedDate({ dueDate: '2026-10-01' }, '2026-11-10')).toBe('2026-11-10');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('buckets by week from today, carries the balance, and finds the lowest week and the first shortfall', () => {
    const f = buildCashForecast({
      today: '2026-11-10',
      opening: 50_000_00,
      weeks: 4,
      items: [
        // Overdue from Kumar: expected this week
        item({ dueDate: '2026-10-20', amount: 20_000_00 }),
        // Due in week 1, but Kumar pays 10 days late: week 2
        item({ dueDate: '2026-11-18', amount: 30_000_00, lateDays: 10 }),
        // Rent and salaries
        item({ kind: 'bill', label: 'Rent', dueDate: '2026-11-12', amount: -45_000_00 }),
        item({ kind: 'recurring_bill', label: 'Salaries', dueDate: '2026-11-19', amount: -60_000_00 }),
        // Beyond four weeks: left out
        item({ dueDate: '2026-12-31', amount: 99_000_00 }),
      ],
    });
    expect(f.weeks.map((w) => [w.start, w.end, w.inflow, w.outflow, w.closing])).toEqual([
      ['2026-11-10', '2026-11-16', 20_000_00, 45_000_00, 25_000_00],
      ['2026-11-17', '2026-11-23', 0, 60_000_00, -35_000_00],
      ['2026-11-24', '2026-11-30', 30_000_00, 0, -5_000_00],
      ['2026-12-01', '2026-12-07', 0, 0, -5_000_00],
    ]);
    expect(f.lowest).toEqual({ start: '2026-11-17', balance: -35_000_00 });
    expect(f.shortfall).toEqual({ start: '2026-11-17', balance: -35_000_00 });
    expect(f.overdue).toEqual({ inflow: 20_000_00, outflow: 0 });
    expect(f.weeks[2]!.items[0]).toMatchObject({ expected: '2026-11-28', lateDays: 10 });
  });

  it('has no shortfall when cash stays above zero, and checks the weeks asked for', () => {
    const f = buildCashForecast({ today: '2026-11-10', opening: 1_000_00, items: [] });
    expect(f.weeks).toHaveLength(13);
    expect(f.shortfall).toBeNull();
    expect(f.lowest).toEqual({ start: '2026-11-10', balance: 1_000_00 });
    expect(cashForecastQuerySchema.parse({})).toEqual({ weeks: 13 });
    expect(cashForecastQuerySchema.safeParse({ weeks: '52' }).success).toBe(false);
  });
});
