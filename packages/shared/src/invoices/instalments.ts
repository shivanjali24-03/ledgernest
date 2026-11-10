import { z } from 'zod';
import { accruedInterest, type InterestEvent, type InterestResult, type InterestTerms } from '../interest/index.js';

/**
 * Instalments: an invoice paid in parts, each due on its own day (a 3-month plan, a deposit and the rest on
 * delivery). Payments clear instalments oldest first; an invoice is overdue only once an instalment past its day
 * isn't covered, and interest on late payment runs on each instalment from its own day.
 */

export interface Instalment {
  dueDate: string;
  /** Smallest unit of the invoice's currency */
  amount: number;
}

export const instalmentsSchema = z
  .array(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number().int().min(1) }))
  .min(2, 'A plan has at least two instalments.')
  .max(60)
  .refine((xs) => xs.every((x, i) => i === 0 || x.dueDate > xs[i - 1]!.dueDate), 'Each instalment falls due after the one before.');

/** What's wrong with a plan for an invoice: the instalments must add up to its total and start on or after its date */
export function instalmentsProblem(plan: Instalment[], total: number, issueDate: string): 'total' | 'before_issue' | null {
  if (plan.reduce((s, x) => s + x.amount, 0) !== total) return 'total';
  if (plan[0] && plan[0].dueDate < issueDate) return 'before_issue';
  return null;
}

/** The same day n months on (the last day of a shorter month) */
function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

/** A total split into equal monthly instalments from a first day, the odd paise on the last */
export function monthlyInstalments(total: number, count: number, first: string): Instalment[] {
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({ dueDate: addMonths(first, i), amount: i === count - 1 ? total - each * (count - 1) : each }));
}

export type InstalmentState = 'paid' | 'partly_paid' | 'due' | 'overdue';

/** Each instalment with what's been paid on it (payments to the oldest first) and where it stands on a day */
export function instalmentStatus(plan: Instalment[], paid: number, today: string) {
  let left = paid;
  return plan.map((x, n) => {
    const covered = Math.min(x.amount, Math.max(0, left));
    left -= covered;
    const state: InstalmentState = covered >= x.amount ? 'paid' : x.dueDate < today ? 'overdue' : covered > 0 ? 'partly_paid' : 'due';
    return { n: n + 1, ...x, paid: covered, balance: x.amount - covered, state };
  });
}

/**
 * Interest on an invoice paid in instalments: each instalment bears interest from its own day on what of it is
 * unpaid, payments going to the oldest first.
 */
export function instalmentInterest(terms: InterestTerms, plan: Instalment[], events: InterestEvent[], asOf: string): InterestResult {
  // Hand out each payment to the instalments in order, so each gets its own dated part-payments
  const sorted = [...events].filter((e) => e.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  const per: InterestEvent[][] = plan.map(() => []);
  const owed = plan.map((x) => x.amount);
  let k = 0;
  for (const e of sorted) {
    let amount = e.amount;
    while (amount > 0 && k < plan.length) {
      const take = Math.min(amount, owed[k]!);
      if (take > 0) per[k]!.push({ date: e.date, amount: take });
      owed[k]! -= take;
      amount -= take;
      if (owed[k] === 0) k++;
    }
  }
  const results = plan.map((x, i) => accruedInterest(terms, { total: x.amount, dueDate: x.dueDate }, per[i]!, asOf));
  return {
    interest: results.reduce((s, r) => s + r.interest, 0),
    perDay: results.reduce((s, r) => s + r.perDay, 0),
    daysLate: Math.max(0, ...results.map((r) => r.daysLate)),
    inGrace: results.some((r) => r.inGrace) && results.every((r) => r.interest === 0),
    periods: results.flatMap((r) => r.periods),
  };
}
