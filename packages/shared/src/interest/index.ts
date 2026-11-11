import { z } from 'zod';

/**
 * Interest on invoices paid late: a yearly rate (basis points, 1800 = 18%) on what's still owed after the due
 * date, worked out day by day on a 365-day year. Part-payments and credit notes reduce what bears interest from
 * the day they're made. A grace period lets a customer pay a few days late without interest; once it's passed,
 * interest runs from the due date. Interest can be simple, or compounded every month after the due date.
 *
 * Amounts are paise. Interest is accumulated exactly (fractions of a paisa carried) and rounded half up at the end.
 */

export const INTEREST_METHODS = ['simple', 'monthly'] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

export interface InterestTerms {
  /** Yearly rate in basis points: 1800 = 18% a year */
  rateBp: number;
  method: InterestMethod;
  /** Days after the due date it may be paid without interest */
  graceDays: number;
}

export const interestTermsSchema = z.object({
  rateBp: z.number().int().min(1, 'Enter a rate above 0%.').max(3600, 'Keep the rate at or under 36% a year.'),
  method: z.enum(INTEREST_METHODS).default('simple'),
  graceDays: z.number().int().min(0).max(365).default(0),
});

const DAY = 86_400_000;
const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY);
/** The same day a month later (the last day of a shorter month), for monthly compounding */
function addMonth(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return iso(target.getTime());
}

/** Something that reduces what's owed: a payment or a credit note, on a day */
export interface InterestEvent {
  date: string;
  amount: number;
}

export interface InterestPeriod {
  from: string;
  /** The last day counted */
  to: string;
  days: number;
  /** What bore interest over these days (paise) */
  principal: number;
  /** Interest for these days, rounded (paise) */
  interest: number;
}

export interface InterestResult {
  /** Interest to the day asked for, rounded half up (paise) */
  interest: number;
  /** What it grows by each day from now on (paise, rounded) */
  perDay: number;
  /** Days late: from the due date to the day asked for, or to when it was paid */
  daysLate: number;
  /** Still within the grace period: nothing is charged yet */
  inGrace: boolean;
  periods: InterestPeriod[];
}

/**
 * Interest on one invoice up to a day (inclusive of days elapsed after the due date): its total, the due date,
 * and every payment and credit against it. Payments go to what's owed first, not to interest.
 */
export function accruedInterest(terms: InterestTerms, invoice: { total: number; dueDate: string }, events: InterestEvent[], asOf: string): InterestResult {
  const none = (daysLate: number, inGrace: boolean): InterestResult => ({ interest: 0, perDay: 0, daysLate, inGrace, periods: [] });
  const sorted = [...events].filter((e) => e.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  // What's owed on the due date, after what came before it
  let owed = invoice.total - sorted.filter((e) => e.date <= invoice.dueDate).reduce((s, e) => s + e.amount, 0);
  const later = sorted.filter((e) => e.date > invoice.dueDate && e.date <= asOf);
  if (owed <= 0 || asOf <= invoice.dueDate) return none(0, false);
  // When it was all paid (if it was), and how late that was
  let left = owed;
  let paidOn: string | null = null;
  for (const e of later) {
    left -= e.amount;
    if (left <= 0) {
      paidOn = e.date;
      break;
    }
  }
  const end = paidOn ?? asOf;
  const daysLate = daysBetween(invoice.dueDate, end);
  if (daysLate <= terms.graceDays) return none(daysLate, !paidOn);

  // Day by day from the due date, split wherever what's owed changes (and, compounding, at each month's end)
  const cuts = new Set<string>(later.map((e) => e.date).filter((d) => d < end));
  if (terms.method === 'monthly')
    for (let n = 1; ; n++) {
      const d = addMonth(invoice.dueDate, n);
      if (d >= end) break;
      cuts.add(d);
    }
  const points = [invoice.dueDate, ...[...cuts].sort(), end];
  // Exact interest in paise × 365 × 10,000 (rate in basis points), so nothing is lost before the final rounding
  const SCALE = 365n * 10_000n;
  let carried = 0n;
  let capitalised = 0n;
  const periods: InterestPeriod[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k]!;
    const to = points[k + 1]!;
    const days = daysBetween(from, to);
    const base = BigInt(owed) * SCALE + capitalised;
    const exact = (base * BigInt(terms.rateBp) * BigInt(days)) / SCALE;
    carried += exact;
    if (days > 0) periods.push({ from, to: iso(at(to) - DAY), days, principal: owed, interest: Number((exact + SCALE / 2n) / SCALE) });
    // Payments on this day reduce what's owed from here on
    for (const e of later.filter((x) => x.date === to)) owed = Math.max(0, owed - e.amount);
    if (terms.method === 'monthly' && to !== end && !later.some((x) => x.date === to)) capitalised = carried;
  }
  const interest = Number((carried + SCALE / 2n) / SCALE);
  const perDay = paidOn ? 0 : Number(((BigInt(owed) * SCALE + (terms.method === 'monthly' ? carried : 0n)) * BigInt(terms.rateBp) + SCALE * SCALE / 2n) / (SCALE * SCALE));
  return { interest, perDay, daysLate, inGrace: false, periods };
}

/** The sentence printed on an invoice that carries interest terms */
export function interestTermsText(t: InterestTerms) {
  const rate = (t.rateBp / 100).toFixed(t.rateBp % 100 ? 2 : 0);
  return `Interest at ${rate}% a year${t.method === 'monthly' ? ', compounded monthly,' : ''} is charged on any amount unpaid after the due date${t.graceDays ? ` (no interest if paid within ${t.graceDays} days of it)` : ''}.`;
}

/** The terms that apply: the invoice's own, else the customer's, else the organisation's; a rate of 0 means none */
export function interestTermsFor(
  org: { rateBp: number | null; method?: InterestMethod; graceDays?: number },
  customer: { rateBp: number | null } | null,
  invoice?: { rateBp: number | null } | null,
): InterestTerms | null {
  const rateBp = invoice?.rateBp ?? customer?.rateBp ?? org.rateBp;
  if (!rateBp) return null;
  return { rateBp, method: org.method ?? 'simple', graceDays: org.graceDays ?? 0 };
}

/** Waiving interest a customer would owe: how much (omitted = everything chargeable now) and why */
export const interestWaiverSchema = z.object({
  amount: z.number().int().min(1).max(1e15).optional(),
  reason: z.string().trim().min(3, 'Say why the interest is waived.').max(500),
});
export type InterestWaiverInput = z.input<typeof interestWaiverSchema>;

/** Raising interest invoices: to which day (default today) */
export const interestRaiseSchema = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** The least worth raising an invoice for: ₹1 */
export const INTEREST_MIN_CHARGE = 100;

/**
 * Interest split over a supply's GST rates in proportion to their taxable value, as GST charges interest on late
 * payment at the rate of the supply it's on (CGST Act s.15(2)(d)); the paise left over go to the largest share.
 */
export function splitInterest(amount: number, parts: { key: string | null; value: number }[]): { key: string | null; amount: number }[] {
  const byKey = new Map<string | null, number>();
  for (const p of parts) if (p.value > 0) byKey.set(p.key, (byKey.get(p.key) ?? 0) + p.value);
  const total = [...byKey.values()].reduce((s, v) => s + v, 0);
  if (!total) return [{ key: null, amount }];
  const shares = [...byKey].map(([key, v]) => ({ key, exact: (amount * v) / total }));
  const out = shares.map((s) => ({ key: s.key, amount: Math.floor(s.exact) }));
  let left = amount - out.reduce((s, x) => s + x.amount, 0);
  const order = shares.map((s, i) => ({ i, frac: s.exact - Math.floor(s.exact) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i]!.amount++;
    left--;
  }
  return out.filter((x) => x.amount > 0);
}
