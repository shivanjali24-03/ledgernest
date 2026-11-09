import { z } from 'zod';
import { MAX_LINE_AMOUNT } from '../journals/index.js';

/**
 * Products and services to put on invoices and bills. Prices are in the base currency's smallest unit;
 * an item can carry its usual tax group, HSN (goods) or SAC (services) code, and the accounts it posts to.
 */
export const ITEM_KINDS = ['goods', 'service'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** HSN codes are 4, 6 or 8 digits; SAC codes are 6 digits starting 99 */
export const HSN_SAC_PATTERN = /^\d{4}(\d{2}){0,2}$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();
const price = z.number().int('Prices are whole numbers of the smallest unit (e.g. paise).').min(0).max(MAX_LINE_AMOUNT).nullable();

const fields = {
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(160, 'Keep it under 160 characters.'),
  kind: z.enum(ITEM_KINDS),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .regex(/^$|^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letters, numbers, dots, dashes, slashes or underscores.')
    .transform((v) => v || null)
    .nullable(),
  description: text(500),
  /** e.g. nos, hrs, kg, month */
  unit: text(16),
  salePrice: price,
  purchasePrice: price,
  taxGroupId: z.uuid().nullable(),
  /** HSN for goods, SAC for services (India) */
  hsnSac: z
    .string()
    .trim()
    .regex(/^$|^\d{4}(\d{2}){0,2}$/, 'Use a 4, 6 or 8-digit HSN or SAC code.')
    .transform((v) => v || null)
    .nullable(),
  /** Where sales of it go (an income account) */
  incomeAccountId: z.uuid().nullable(),
  /** Where purchases of it go (an expense or asset account) */
  expenseAccountId: z.uuid().nullable(),
  /** Goods whose quantity on hand is kept: bought into the inventory account, sold at average cost */
  trackStock: z.boolean(),
  /** The inventory (asset) account the stock sits in */
  inventoryAccountId: z.uuid().nullable(),
  /** The cost of sales account stock goes to as it's sold */
  cogsAccountId: z.uuid().nullable(),
};

export const itemCreateSchema = z.object({
  name: fields.name,
  kind: fields.kind.optional().default('service'),
  sku: fields.sku.optional().default(null),
  description: fields.description.optional().default(null),
  unit: fields.unit.optional().default(null),
  salePrice: fields.salePrice.optional().default(null),
  purchasePrice: fields.purchasePrice.optional().default(null),
  taxGroupId: fields.taxGroupId.optional().default(null),
  hsnSac: fields.hsnSac.optional().default(null),
  incomeAccountId: fields.incomeAccountId.optional().default(null),
  expenseAccountId: fields.expenseAccountId.optional().default(null),
  trackStock: fields.trackStock.optional().default(false),
  inventoryAccountId: fields.inventoryAccountId.optional().default(null),
  cogsAccountId: fields.cogsAccountId.optional().default(null),
});
export type ItemCreateInput = z.input<typeof itemCreateSchema>;

export const itemUpdateSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type ItemUpdateInput = z.input<typeof itemUpdateSchema>;

export const itemListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  kind: z.enum(ITEM_KINDS).optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
