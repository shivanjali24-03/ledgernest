import { z } from 'zod';

/**
 * Reports that arrive by themselves: a report, how often (weekly on a weekday, or monthly on a day), Excel or
 * CSV, and which members it goes to. Each run covers the period just ended: the last seven days, or last
 * calendar month; as-of reports (balance sheet, trial balance, aging) are as of that period's last day.
 */
export const SCHEDULED_REPORTS = ['profit_and_loss', 'balance_sheet', 'trial_balance', 'receivables_aging', 'payables_aging'] as const;
export type ScheduledReportKind = (typeof SCHEDULED_REPORTS)[number];
export const REPORT_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export const REPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
/** Runs go out at this hour, UTC (about mid-morning in India, early morning in Europe) */
export const REPORT_RUN_HOUR_UTC = 4;

const fields = z.object({
  name: z.string().trim().min(2, 'Name it.').max(120),
  report: z.enum(SCHEDULED_REPORTS),
  frequency: z.enum(REPORT_FREQUENCIES),
  /** weekly: 1 (Monday) to 7 (Sunday); monthly: 1 to 28 */
  day: z.number().int().min(1).max(28),
  format: z.enum(REPORT_FORMATS).default('xlsx'),
  recipients: z.array(z.uuid()).min(1, 'Choose who it goes to.').max(50),
  active: z.boolean().optional().default(true),
});
export const scheduledReportSchema = fields.refine((s) => s.frequency !== 'weekly' || s.day <= 7, { path: ['day'], message: 'Choose a day of the week.' });
/** Changing one: any of the same fields (the day is checked against the frequency it ends up with) */
export const scheduledReportUpdateSchema = fields.partial();
export type ScheduledReportInput = z.input<typeof scheduledReportSchema>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** The next run strictly after a moment: the weekday (1 = Monday) or day of the month, at REPORT_RUN_HOUR_UTC */
export function nextReportRun(after: Date, frequency: ReportFrequency, dayOf: number): Date {
  const at = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), REPORT_RUN_HOUR_UTC));
  if (frequency === 'weekly') {
    for (let n = 0; n <= 7; n++) {
      const d = at(addDays(after, n));
      if (((d.getUTCDay() + 6) % 7) + 1 === dayOf && d > after) return d;
    }
    return at(addDays(after, 7));
  }
  for (let m = 0; m <= 2; m++) {
    const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + m, dayOf, REPORT_RUN_HOUR_UTC));
    if (d > after) return d;
  }
  return new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, dayOf, REPORT_RUN_HOUR_UTC));
}

/** The period a run on a day covers: the seven days before it, or the calendar month before it */
export function reportPeriod(runDay: string, frequency: ReportFrequency): { from: string; to: string } {
  const run = new Date(`${runDay}T00:00:00Z`);
  if (frequency === 'weekly') return { from: day(addDays(run, -7)), to: day(addDays(run, -1)) };
  const first = new Date(Date.UTC(run.getUTCFullYear(), run.getUTCMonth() - 1, 1));
  return {
    from: day(first),
    to: day(new Date(Date.UTC(run.getUTCFullYear(), run.getUTCMonth(), 0))),
  };
}
