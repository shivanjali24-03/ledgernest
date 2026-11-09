import { z } from 'zod';

/** A calendar day as "YYYY-MM-DD". Accounting dates are days, not moments: the organisation's time zone decides which day "now" is. */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isoDaySchema = z.string().regex(ISO_DAY, 'Use a date like 2026-04-01.').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'That date does not exist.');

const pad = (n: number) => String(n).padStart(2, '0');
const day = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** The day it is right now in a time zone, e.g. today in Asia/Kolkata. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

export interface PeriodSpan {
  number: number;
  startDate: string;
  endDate: string;
}

/** A financial year starting in `startMonth` of `startYear`, split into 12 calendar-month periods. */
export function fiscalYearSpan(startYear: number, startMonth: number) {
  const periods: PeriodSpan[] = Array.from({ length: 12 }, (_, i) => ({
    number: i + 1,
    startDate: day(startYear, startMonth + i, 1),
    endDate: day(startYear, startMonth + i + 1, 0),
  }));
  return { startDate: periods[0]!.startDate, endDate: periods[11]!.endDate, periods };
}

/** "FY 2026" for a calendar year, "FY 2026–27" when it spans two. */
export const fiscalYearName = (startYear: number, startMonth: number) => (startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}–${String(startYear + 1).slice(2)}`);

/** The start year of the financial year containing a day. */
export function fiscalYearOf(isoDay: string, startMonth: number): number {
  const [y, m] = isoDay.split('-').map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}

export const fiscalYearCreateSchema = z.object({
  /** Calendar year the financial year starts in, e.g. 2026 for FY 2026–27 */
  startYear: z.number().int().min(2000).max(2100),
});
export type FiscalYearCreateInput = z.infer<typeof fiscalYearCreateSchema>;

export const periodActionSchema = z.object({ reason: z.string().trim().max(500).optional() });
