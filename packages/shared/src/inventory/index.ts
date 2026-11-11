import { z } from 'zod';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';
import { batchDatesInOrder, batchFieldShape, BATCH_DATES_MESSAGE } from './batches.js';
import { serialsSchema } from './serials.js';

/**
 * Stock kept at weighted average cost. Each movement in (a bill, an adjustment up) adds its quantity and value;
 * each movement out (an invoice, an adjustment down) takes the quantity at the average cost of what is on hand,
 * so taking everything clears the value exactly. Quantities are in ten-thousandths, like invoice lines.
 */
export const STOCK_MOVEMENT_KINDS = ['bill', 'bill_void', 'invoice', 'invoice_void', 'credit_note', 'credit_note_void', 'debit_note', 'debit_note_void', 'challan_out', 'challan_back', 'grn', 'adjustment', 'adjustment_undo'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** The value of some of what's on hand, at its average cost (rounded half up) */
export function costOfQuantity(onHand: bigint, value: bigint, quantity: bigint): bigint {
  if (quantity <= 0n || onHand <= 0n) return 0n;
  if (quantity >= onHand) return value;
  const n = value * quantity * 2n + onHand;
  return n >= 0n ? n / (onHand * 2n) : -((-n + onHand * 2n - 1n) / (onHand * 2n));
}

/** Average cost of one unit, in the smallest currency unit (rounded), or null with nothing on hand */
export const averageUnitCost = (onHand: bigint, value: bigint): number | null => (onHand > 0n ? Number((value * 10_000n * 2n + onHand) / (onHand * 2n)) : null);

const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, 'Enter a quantity with up to 4 decimal places.')
  .refine((v) => Number(v) > 0, 'Enter a quantity above zero.');

/** Counting stock up (found, opening stock) or down (damaged, lost, used in-house), against another account */
export const stockAdjustmentSchema = z
  .object({
    itemId: z.uuid(),
    date: isoDaySchema,
    direction: z.enum(['in', 'out']),
    quantity,
    /** For stock in: what one unit cost, in the smallest unit; omitted = the current average cost */
    unitCost: z.number().int().min(0).max(MAX_LINE_AMOUNT).nullable().optional().default(null),
    /** The other side: e.g. stock written off (expense) or opening balances (equity) */
    accountId: z.uuid(),
    reason: z.string().trim().min(3, 'Say why the stock changed.').max(500),
    /** For goods kept in batches: the batch counted (with its dates when it's new stock) */
    ...batchFieldShape,
    /** For goods with serial numbers: the units counted in or written off */
    serials: serialsSchema,
  })
  .strict()
  .refine(batchDatesInOrder, { path: ['expiryDate'], message: BATCH_DATES_MESSAGE });
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

export const stockValuationQuerySchema = z.object({ asOf: isoDaySchema.optional() });
export * from './batches.js';
export * from './serials.js';

/** Opening stock for many items on the day the books start, each at what one unit cost */
export const openingStockSchema = z.object({
  date: isoDaySchema,
  lines: z
    .array(
      z
        .object({
          itemId: z.uuid(),
          quantity,
          unitCost: z.number().int().min(0).max(MAX_LINE_AMOUNT),
          ...batchFieldShape,
          serials: serialsSchema,
        })
        .refine(batchDatesInOrder, { path: ['expiryDate'], message: BATCH_DATES_MESSAGE }),
    )
    .min(1, 'Enter the stock of at least one item.')
    .max(500),
});
export type OpeningStockInput = z.input<typeof openingStockSchema>;
