import { describe, expect, it } from 'vitest';
import { accruedInterest } from '../interest/index.js';
import { instalmentInterest, instalmentStatus, instalmentsProblem, instalmentsSchema, monthlyInstalments } from './instalments.js';

const terms = { rateBp: 1800, method: 'simple' as const, graceDays: 0 };

describe('Instalments', () => {
  it('splits a total into equal monthly instalments, the odd paise last, keeping to month ends', () => {
    expect(monthlyInstalments(1_00_000_00, 3, '2026-01-31')).toEqual([
      { dueDate: '2026-01-31', amount: 33_333_33 },
      { dueDate: '2026-02-28', amount: 33_333_33 },
      { dueDate: '2026-03-31', amount: 33_333_34 },
    ]);
  });

  it('checks a plan: in order, adding up to the total, not before the invoice', () => {
    expect(instalmentsSchema.safeParse([{ dueDate: '2026-02-01', amount: 1 }, { dueDate: '2026-01-01', amount: 1 }]).success).toBe(false);
    expect(instalmentsSchema.safeParse([{ dueDate: '2026-02-01', amount: 1 }]).success).toBe(false);
    const plan = monthlyInstalments(900, 3, '2026-02-01');
    expect(instalmentsProblem(plan, 900, '2026-01-15')).toBeNull();
    expect(instalmentsProblem(plan, 901, '2026-01-15')).toBe('total');
    expect(instalmentsProblem(plan, 900, '2026-03-01')).toBe('before_issue');
  });

  it('clears instalments oldest first, and is overdue only for an uncovered one past its day', () => {
    const plan = monthlyInstalments(30_000_00, 3, '2026-06-01');
    expect(instalmentStatus(plan, 15_000_00, '2026-06-15').map((x) => [x.state, x.paid])).toEqual([
      ['paid', 10_000_00],
      ['partly_paid', 5_000_00],
      ['due', 0],
    ]);
    expect(instalmentStatus(plan, 15_000_00, '2026-07-02').map((x) => x.state)).toEqual(['paid', 'overdue', 'due']);
  });

  it('charges interest on each instalment from its own day', () => {
    const plan = [
      { dueDate: '2026-06-01', amount: 50_000_00 },
      { dueDate: '2026-07-01', amount: 50_000_00 },
    ];
    // Nothing paid by 31 July: 60 days on the first half, 30 on the second
    const r = instalmentInterest(terms, plan, [], '2026-07-31');
    expect(r.interest).toBe(Math.round((50_000_00 * 0.18 * 60) / 365) + Math.round((50_000_00 * 0.18 * 30) / 365));
    // A payment on 1 July clears the first instalment; interest on it stops there
    const paid = instalmentInterest(terms, plan, [{ date: '2026-07-01', amount: 50_000_00 }], '2026-07-31');
    expect(paid.interest).toBe(accruedInterest(terms, { total: 50_000_00, dueDate: '2026-06-01' }, [{ date: '2026-07-01', amount: 50_000_00 }], '2026-07-31').interest + Math.round((50_000_00 * 0.18 * 30) / 365));
  });
});
