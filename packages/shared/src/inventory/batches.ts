import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/**
 * Batches (lots) of goods that expire: medicines, food, chemicals. Each batch carries the number on the pack and
 * its manufacturing and expiry dates. Stock is still valued at the item's average cost; batches say which packs
 * are on the shelf, so sales take the earliest-expiring first and never anything already expired.
 */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const batchNoSchema = z
  .string()
  .trim()
  .min(1, 'Enter the batch number.')
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/, 'Use letters, digits, spaces, dots, dashes, slashes or underscores.');

/** The fields a batch brings in with (for building other schemas) */
export const batchFieldShape = {
  batchNo: z.preprocess(blank, batchNoSchema.nullable().optional().default(null)),
  mfgDate: z.preprocess(blank, isoDaySchema.nullable().optional().default(null)),
  expiryDate: z.preprocess(blank, isoDaySchema.nullable().optional().default(null)),
};
export const batchDatesInOrder = (v: { mfgDate?: string | null; expiryDate?: string | null }) => !v.mfgDate || !v.expiryDate || v.mfgDate < v.expiryDate;
export const BATCH_DATES_MESSAGE = 'The expiry date must be after the manufacturing date.';

/** A batch as a bill line or a stock count brings it in */
export const batchFieldsSchema = z.object(batchFieldShape).refine(batchDatesInOrder, { path: ['expiryDate'], message: BATCH_DATES_MESSAGE });
export type BatchFields = z.output<typeof batchFieldsSchema>;

/** Expired on a day: the expiry date has passed (goods are good through their expiry date) */
export const batchExpired = (expiryDate: string | null | undefined, day: string) => !!expiryDate && expiryDate < day;

/** Days from a day to the expiry date (negative once expired), or null for a batch without one */
export const daysToExpiry = (expiryDate: string | null | undefined, day: string) => (expiryDate ? Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000) : null);

export interface BatchStock {
  id: string;
  batchNo: string;
  expiryDate: string | null;
  /** Ten-thousandths on hand */
  onHand: bigint;
  /** For a tie: the batch received first goes first */
  receivedAt: string;
}

/**
 * What to take from which batch to sell a quantity on a day: earliest expiry first (batches without an expiry
 * date last, then the oldest), skipping expired batches. Short when the unexpired stock isn't enough.
 */
export function allocateBatches(batches: BatchStock[], quantity: bigint, day: string): { take: { id: string; quantity: bigint }[]; short: bigint } {
  const usable = batches
    .filter((b) => b.onHand > 0n && !batchExpired(b.expiryDate, day))
    .sort((a, b) => (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.receivedAt.localeCompare(b.receivedAt));
  const take: { id: string; quantity: bigint }[] = [];
  let left = quantity;
  for (const b of usable) {
    if (left <= 0n) break;
    const q = b.onHand < left ? b.onHand : left;
    take.push({ id: b.id, quantity: q });
    left -= q;
  }
  return { take, short: left > 0n ? left : 0n };
}

/** A batch on an invoice or PDF: "Batch B123 · Mfg 01/2026 · Exp 12/2027" */
export function batchLabel(b: { batchNo: string; mfgDate?: string | null; expiryDate?: string | null }) {
  const my = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return [`Batch ${b.batchNo}`, b.mfgDate && `Mfg ${my(b.mfgDate)}`, b.expiryDate && `Exp ${my(b.expiryDate)}`].filter(Boolean).join(' · ');
}
