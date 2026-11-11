import { zeroHeads, type GstHeads } from '../taxes/index.js';

/**
 * Rule 37 of the CGST Rules: input tax credit is kept only if the supplier is paid (value plus tax) within 180 days of
 * their invoice. Credit on what's still unpaid then is reversed (added to the tax due, with interest under s.50) in the
 * return for the period the 180 days end in, in proportion to what's unpaid; it's reclaimed once the supplier is paid.
 * Reverse-charge purchases don't count: the tax is ours to pay, not the supplier's.
 */
export const ITC_PAYMENT_DAYS = 180;
/** How long before the deadline a bill is flagged */
export const ITC_WARNING_DAYS = 30;

const DAY = 86_400_000;
const add = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The last day to pay the supplier and keep the credit */
export const itcPaymentDeadline = (invoiceDate: string) => add(invoiceDate, ITC_PAYMENT_DAYS);

export type ItcBillInput = {
  id: string;
  /** The supplier's invoice date */
  invoiceDate: string;
  total: number;
  /** The credit taken on it, by head */
  credit: GstHeads;
  /** Payments and credits against it, by day */
  settlements: { date: string; amount: number }[];
};

export type ItcBillState = 'ok' | 'due_soon' | 'reverse' | 'reclaim';

/** Splits a credit in proportion: the part of each head that goes with `part` of `whole` */
export function shareOf(credit: GstHeads, part: number, whole: number): GstHeads {
  const out = zeroHeads();
  if (whole <= 0 || part <= 0) return out;
  const p = Math.min(part, whole);
  for (const h of ['igst', 'cgst', 'sgst', 'cess'] as const) out[h] = Math.round((credit[h] * p) / whole);
  return out;
}

const headsTotal = (h: GstHeads) => h.igst + h.cgst + h.sgst + h.cess;

/**
 * A bill on the day: its deadline, what was unpaid when it passed, and the credit to reverse (still unpaid) or to take
 * back (paid since). `due_soon` is within ITC_WARNING_DAYS of the deadline and not fully paid.
 */
export function itcBillStatus(b: ItcBillInput, asOf: string) {
  const deadline = itcPaymentDeadline(b.invoiceDate);
  const paidBy = (day: string) => b.settlements.filter((s) => s.date <= day).reduce((s, x) => s + x.amount, 0);
  const unpaidNow = Math.max(b.total - paidBy(asOf), 0);
  const passed = asOf > deadline;
  const unpaidAtDeadline = passed ? Math.max(b.total - paidBy(deadline), 0) : unpaidNow;
  // Reversed at the deadline on what was unpaid; what's been paid since comes back
  const reversed = passed ? shareOf(b.credit, unpaidAtDeadline, b.total) : zeroHeads();
  const stillReversed = passed ? shareOf(b.credit, unpaidNow, b.total) : zeroHeads();
  const reclaimable = zeroHeads();
  for (const h of ['igst', 'cgst', 'sgst', 'cess'] as const) reclaimable[h] = reversed[h] - stillReversed[h];
  const daysLeft = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY);
  const state: ItcBillState = passed
    ? unpaidNow > 0
      ? 'reverse'
      : headsTotal(reclaimable) > 0
        ? 'reclaim'
        : 'ok'
    : unpaidNow > 0 && daysLeft <= ITC_WARNING_DAYS
      ? 'due_soon'
      : 'ok';
  return {
    id: b.id,
    deadline,
    daysLeft,
    state,
    balance: unpaidNow,
    /** The credit at stake: what would be (or was) reversed for what's unpaid now */
    atRisk: shareOf(b.credit, unpaidNow, b.total),
    reversed: stillReversed,
    reclaimable,
  };
}

/**
 * For a return period: credit to reverse in 4(B)(2) (bills whose 180 days ended in it, on what was unpaid then) and
 * to take back in 4(D)(1)/4(A)(5) (bills reversed before, paid during it).
 */
export function itcRule37ForPeriod(bills: ItcBillInput[], from: string, to: string) {
  const reverse = zeroHeads();
  const reclaim = zeroHeads();
  for (const b of bills) {
    const deadline = itcPaymentDeadline(b.invoiceDate);
    const paidBy = (day: string) => b.settlements.filter((s) => s.date <= day).reduce((s, x) => s + x.amount, 0);
    // The 180 days end in the period: reverse on what was unpaid at the deadline
    if (deadline >= from && deadline <= to) {
      const r = shareOf(b.credit, b.total - paidBy(deadline), b.total);
      for (const h of ['igst', 'cgst', 'sgst', 'cess'] as const) reverse[h] += r[h];
    }
    // Paid during the period after its deadline: take back the credit on what was paid (up to what was reversed)
    if (deadline < to) {
      const start = deadline >= from ? deadline : add(from, -1);
      const before = Math.max(b.total - paidBy(start), 0);
      const after = Math.max(b.total - paidBy(to), 0);
      if (before > after) {
        const back = shareOf(b.credit, before - after, b.total);
        for (const h of ['igst', 'cgst', 'sgst', 'cess'] as const) reclaim[h] += back[h];
      }
    }
  }
  return { reverse, reclaim };
}
