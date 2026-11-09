import { z } from 'zod';
import { invoiceLineSchema, MAX_INVOICE_LINES } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

export const RECURRING_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_STATUSES = ['active', 'paused', 'ended'] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

const daysIn = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/**
 * The n-th date of a schedule (n = 0 is the start), always counted from the start so it never drifts:
 * monthly from 31 January is 28 (or 29) February, then 31 March.
 */
export function occurrenceDate(start: string, frequency: RecurringFrequency, interval: number, n: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  if (frequency === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7 * interval * n)).toISOString().slice(0, 10);
  const months = interval * n * (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(year, month0, Math.min(d, daysIn(year, month0)))).toISOString().slice(0, 10);
}

/** The next date to raise an invoice on after `count` have been raised, or null once the schedule is over */
export function nextOccurrence(s: { startDate: string; frequency: RecurringFrequency; interval: number; endDate: string | null; maxCount: number | null }, count: number): string | null {
  if (s.maxCount !== null && count >= s.maxCount) return null;
  const next = occurrenceDate(s.startDate, s.frequency, s.interval, count);
  return s.endDate && next > s.endDate ? null : next;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

/** A schedule and the invoice it raises each time: the template's lines, reference and notes */
export const recurringSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the schedule.').max(120),
    contactId: z.uuid(),
    frequency: z.enum(RECURRING_FREQUENCIES),
    interval: z.number().int().min(1).max(12).optional().default(1),
    startDate: isoDaySchema,
    endDate: isoDaySchema.nullable().optional().default(null),
    maxCount: z.number().int().min(1).max(1000).nullable().optional().default(null),
    /** Issue each invoice as it's raised, rather than leaving a draft to check */
    autoIssue: z.boolean().optional().default(false),
    reference: text(100),
    notes: text(1000),
    placeOfSupply: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    lines: z.array(invoiceLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'The end date can’t be before the start.' });
export type RecurringInput = z.input<typeof recurringSchema>;

export const upcomingQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
