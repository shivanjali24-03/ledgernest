import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/** Days past due, in the buckets every aging report uses */
export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_SIDES = ['receivables', 'payables'] as const;
export type AgingSide = (typeof AGING_SIDES)[number];

/** Whole days from one ISO day to another (negative when `to` is earlier) */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The bucket for a document due on `dueDate`, seen on `asOf`: not yet due (or due that day) is current. */
export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const late = daysBetween(dueDate, asOf);
  return late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'over_90';
}

export const agingQuerySchema = z.object({ side: z.enum(AGING_SIDES), asOf: isoDaySchema.optional() });
