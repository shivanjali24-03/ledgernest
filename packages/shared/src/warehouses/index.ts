import { z } from 'zod';
import { parseQuantity } from '../invoices/index.js';
import { serialsSchema } from '../inventory/serials.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Warehouses: the places stock is kept (godowns, shops, branches). Until there's one, stock is just stock; the first
 * one made brings a main warehouse with it that takes all the stock there was. Each keeps its own quantities and
 * average cost; goods move between them on transfers (TR-0001), their value with them, with no entry.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const warehouseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,10}$/, 'Use up to 10 letters, digits and dashes.');

const addressSchema = z
  .object({ line1: text(120), line2: text(120), city: text(60), region: text(60), postalCode: text(12), country: text(2) })
  .nullable()
  .optional()
  .default(null);

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, 'Name the warehouse.').max(80),
  /** Short code for lists and documents; made from the name when left out */
  code: warehouseCodeSchema.optional(),
  address: addressSchema,
});
export type WarehouseInput = z.input<typeof warehouseSchema>;

export const warehouseUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name the warehouse.').max(80).optional(),
  address: addressSchema.optional(),
  /** Make it the main warehouse: where stock goes when a document doesn't say */
  isDefault: z.literal(true).optional(),
});
export type WarehouseUpdateInput = z.input<typeof warehouseUpdateSchema>;

const quantity = z
  .string()
  .trim()
  .refine((q) => (parseQuantity(q) ?? 0n) > 0n, 'Enter a quantity above 0.');

export const stockTransferSchema = z
  .object({
    date: isoDaySchema,
    fromWarehouseId: z.uuid(),
    toWarehouseId: z.uuid(),
    reference: text(64),
    notes: text(500),
    lines: z
      .array(
        z.object({
          itemId: z.uuid(),
          quantity,
          /** For goods kept in batches: which batch moves (omitted = earliest expiry first) */
          batchId: z.uuid().nullable().optional().default(null),
          /** For goods with serial numbers: which units move */
          serials: serialsSchema,
        }),
      )
      .min(1, 'Move at least one item.')
      .max(200),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, { path: ['toWarehouseId'], message: 'Choose another warehouse to move to.' });
export type StockTransferInput = z.input<typeof stockTransferSchema>;

/** "TR-0001" */
export const transferNumber = (n: number) => `TR-${String(n).padStart(4, '0')}`;

/** A code from a name: its first letters, upper case ("Bhiwandi godown" → "BHIW") */
export function warehouseCodeFrom(name: string) {
  return (
    name
      .normalize('NFKD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'WH'
  );
}
