import type { MsmeCategory } from '../contacts/index.js';

/**
 * Paying micro and small suppliers on time. The MSMED Act (section 15) gives a buyer the agreed credit period, never
 * more than 45 days from the bill, or 15 days with no agreement. Income-tax section 43B(h) then takes the expense out of
 * the year's profit for anything still unpaid past that day at the year end: it's only allowed in the year it's paid.
 * Medium enterprises aren't covered. Each bill gets its deadline, and the year's amount at risk is worked out.
 */

export const MSME_MAX_DAYS = 45;
/** Days to pay when nothing was agreed */
export const MSME_DEFAULT_DAYS = 15;
/** A deadline this close shows as due soon */
export const MSME_SOON_DAYS = 7;

/** Whether the 45-day rule covers a supplier */
export const msmeCovered = (c: MsmeCategory | null | undefined) => c === 'micro' || c === 'small';

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The last day to pay: the bill's due date, never later than 45 days from the bill (no due date agreed: 15 days) */
export function msmeDeadline(billDate: string, dueDate: string | null): string {
  const cap = addDays(billDate, MSME_MAX_DAYS);
  const agreed = dueDate ?? addDays(billDate, MSME_DEFAULT_DAYS);
  return agreed < cap ? agreed : cap;
}

export interface MsmeBillInput {
  id: string;
  number: string;
  vendor: { id: string; name: string; category: MsmeCategory; udyamNumber: string | null };
  billDate: string;
  dueDate: string;
  /** Paise */
  total: number;
  /** Taxable value, the expense the deduction is about (paise) */
  subtotal: number;
  /** Each payment or debit note set against the bill */
  settlements: { date: string; amount: number }[];
}

export type MsmeState = 'paid_on_time' | 'paid_late' | 'overdue' | 'due_soon' | 'open';

export interface MsmeBill {
  id: string;
  number: string;
  vendor: MsmeBillInput['vendor'];
  billDate: string;
  deadline: string;
  total: number;
  /** Still owed today */
  balance: number;
  /** Days to the deadline (negative: days past it) */
  daysLeft: number;
  state: MsmeState;
  /** Owed past the deadline and at the year end, as the share of the taxable value (paise) */
  disallowed: number;
}

export interface MsmeReport {
  asOf: string;
  fiscalYear: { from: string; to: string };
  bills: MsmeBill[];
  totals: { overdue: number; dueSoon: number; disallowed: number; paidLate: number };
}

/**
 * Bills from micro and small suppliers dated in the year (or still owed from before), each with its deadline and
 * state today, and what section 43B(h) takes out of the year: owed past the deadline and still owed at the year end
 * (as it stands today, before the year closes).
 */
export function msmeReport(bills: MsmeBillInput[], asOf: string, fiscalYear: { from: string; to: string }): MsmeReport {
  const out: MsmeBill[] = [];
  for (const b of bills) {
    if (!msmeCovered(b.vendor.category)) continue;
    const deadline = msmeDeadline(b.billDate, b.dueDate);
    const paidBy = (day: string) => b.settlements.filter((s) => s.date <= day).reduce((n, s) => n + s.amount, 0);
    const balance = Math.max(0, b.total - paidBy(asOf));
    const inYear = b.billDate >= fiscalYear.from && b.billDate <= fiscalYear.to;
    if (!inYear && !(b.billDate < fiscalYear.from && balance > 0)) continue;
    const late = b.total - paidBy(deadline);
    const daysLeft = daysBetween(asOf, deadline);
    const state: MsmeState =
      balance === 0 ? (late > 0 ? 'paid_late' : 'paid_on_time') : daysLeft < 0 ? 'overdue' : daysLeft <= MSME_SOON_DAYS ? 'due_soon' : 'open';
    // Unpaid at the deadline and at the year end (payments after the year end but before a later deadline still count)
    const yearEnd = fiscalYear.to;
    const owedAtYearEnd = b.total - paidBy(deadline > yearEnd ? deadline : yearEnd);
    // Only once the deadline has gone: before that there's still time to pay
    const atRisk = inYear && deadline < asOf ? Math.max(0, Math.min(late, owedAtYearEnd)) : 0;
    out.push({
      id: b.id,
      number: b.number,
      vendor: b.vendor,
      billDate: b.billDate,
      deadline,
      total: b.total,
      balance,
      daysLeft,
      state,
      disallowed: b.total ? Math.round((atRisk * b.subtotal) / b.total) : 0,
    });
  }
  const rank: Record<MsmeState, number> = { overdue: 0, due_soon: 1, open: 2, paid_late: 3, paid_on_time: 4 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || a.deadline.localeCompare(b.deadline) || a.number.localeCompare(b.number));
  const sum = (f: (b: MsmeBill) => number) => out.reduce((n, b) => n + f(b), 0);
  return {
    asOf,
    fiscalYear,
    bills: out,
    totals: {
      overdue: sum((b) => (b.state === 'overdue' ? b.balance : 0)),
      dueSoon: sum((b) => (b.state === 'due_soon' ? b.balance : 0)),
      disallowed: sum((b) => b.disallowed),
      paidLate: sum((b) => (b.state === 'paid_late' ? b.total : 0)),
    },
  };
}

/**
 * Interest a buyer owes a micro or small supplier for paying late (MSMED Act section 16): compound interest with
 * monthly rests at three times the RBI bank rate, from the day after the appointed day until it's paid. In paise;
 * months are counted as twelfths of a year, so it reads as an estimate to the rupee.
 */
export function msmeLateInterest(balance: number, billDate: string, dueDate: string | null, asOf: string, bankRateBp: number): number {
  if (balance <= 0 || bankRateBp <= 0) return 0;
  const days = daysBetween(msmeDeadline(billDate, dueDate), asOf);
  if (days <= 0) return 0;
  const monthly = (3 * bankRateBp) / 10_000 / 12;
  return Math.round(balance * ((1 + monthly) ** (days / (365 / 12)) - 1));
}
