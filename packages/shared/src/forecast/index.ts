import { z } from 'zod';

/**
 * A cash-flow forecast: today's cash, then week by week what should come in (customers' invoices, on the day each
 * customer usually pays, not the day it's due) and go out (bills on their due dates, repeat invoices and bills as
 * they're raised), with the balance at the end of each week and the first week it would run short.
 */

export type ForecastKind = 'invoice' | 'bill' | 'recurring_invoice' | 'recurring_bill';

export interface ForecastItem {
  kind: ForecastKind;
  /** The invoice, bill or schedule */
  id: string;
  label: string;
  contact: { id: string; name: string };
  /** When it's due (for a schedule, when it will be raised plus the contact's terms) */
  dueDate: string;
  /** In the base currency's smallest unit: positive comes in, negative goes out */
  amount: number;
  /** Days late this customer usually pays, added to the due date (customers' invoices only) */
  lateDays?: number;
}

export interface ForecastWeek {
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  closing: number;
  items: (ForecastItem & { expected: string })[];
}

export interface CashForecast {
  today: string;
  opening: number;
  weeks: ForecastWeek[];
  /** The lowest closing balance, and the week it falls in */
  lowest: { start: string; balance: number };
  /** The first week ending below zero, if any */
  shortfall: { start: string; balance: number } | null;
  /** Already overdue, counted in the first week */
  overdue: { inflow: number; outflow: number };
}

export const cashForecastQuerySchema = z.object({ weeks: z.coerce.number().int().min(4).max(26).default(13) });

const DAY = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * How late a customer usually pays: the average days from due date to fully paid over their paid invoices (early
 * counts as on time), rounded; none until there are two to go on, and at most 90 days.
 */
export function usualLateness(paid: { dueDate: string; paidOn: string }[]): number | null {
  if (paid.length < 2) return null;
  const late = paid.reduce((s, p) => s + Math.max(0, daysBetween(p.dueDate, p.paidOn)), 0) / paid.length;
  return Math.min(90, Math.round(late));
}

/** When the money should move: the due date (plus usual lateness), but never before today */
export const expectedDate = (item: Pick<ForecastItem, 'dueDate' | 'lateDays'>, today: string) => {
  const d = addDays(item.dueDate, item.lateDays ?? 0);
  return d < today ? today : d;
};

export function buildCashForecast({ today, opening, items, weeks = 13 }: { today: string; opening: number; items: ForecastItem[]; weeks?: number }): CashForecast {
  const out: ForecastWeek[] = Array.from({ length: weeks }, (_, w) => ({ start: addDays(today, w * 7), end: addDays(today, w * 7 + 6), inflow: 0, outflow: 0, closing: 0, items: [] }));
  const overdue = { inflow: 0, outflow: 0 };
  for (const item of items) {
    if (!item.amount) continue;
    const expected = expectedDate(item, today);
    const w = Math.floor(daysBetween(today, expected) / 7);
    if (w >= weeks) continue;
    const week = out[w]!;
    if (item.amount > 0) week.inflow += item.amount;
    else week.outflow -= item.amount;
    if (addDays(item.dueDate, item.lateDays ?? 0) < today) {
      if (item.amount > 0) overdue.inflow += item.amount;
      else overdue.outflow -= item.amount;
    }
    week.items.push({ ...item, expected });
  }
  let balance = opening;
  let lowest = { start: today, balance: opening };
  let shortfall: CashForecast['shortfall'] = null;
  for (const week of out) {
    balance += week.inflow - week.outflow;
    week.closing = balance;
    week.items.sort((a, b) => a.expected.localeCompare(b.expected) || b.amount - a.amount);
    if (balance < lowest.balance) lowest = { start: week.start, balance };
    if (!shortfall && balance < 0) shortfall = { start: week.start, balance };
  }
  return { today, opening, weeks: out, lowest, shortfall, overdue };
}
