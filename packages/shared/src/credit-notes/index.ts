import { z } from 'zod';
import { serialsSchema } from '../inventory/serials.js';
import { rateSchema } from '../currencies/index.js';
import { invoiceNumber, parseQuantity } from '../invoices/index.js';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';

const amount = z.number().int().positive('Enter an amount above 0.').max(MAX_LINE_AMOUNT);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

/** A credit note takes back some (or all) of an invoice's lines: how much of each */
export const creditNoteSchema = z.object({
  invoiceId: z.uuid(),
  date: isoDaySchema,
  /** The number series to number it from; omitted = the default */
  seriesId: z.uuid().nullable().optional().default(null),
  reason: text(500),
  /** Goods came back: tracked items return to stock at the cost they left at, out of cost of sales */
  returnsStock: z.boolean().optional().default(false),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.uuid(),
        /** For goods with serial numbers coming back: which units */
        serials: serialsSchema,
        quantity: z
          .string()
          .trim()
          .refine((q) => (parseQuantity(q) ?? 0n) > 0n, 'Enter a quantity above 0.'),
      }),
    )
    .min(1, 'Credit at least one line.'),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

/** Puts some of a credit note's remaining credit onto another of the customer's invoices */
export const creditApplySchema = z.object({ invoiceId: z.uuid(), amount, date: isoDaySchema.optional() });
export type CreditApplyInput = z.input<typeof creditApplySchema>;

/** Pays some of a credit note's remaining credit back to the customer */
export const creditRefundSchema = z.object({ date: isoDaySchema, bankAccountId: z.uuid(), amount, rate: rateSchema.nullable().optional().default(null), reference: text(100) });
export type CreditRefundInput = z.input<typeof creditRefundSchema>;

export const creditNoteVoidSchema = z.object({ date: isoDaySchema.optional(), reason: z.string().trim().max(500).optional() });

export const creditNoteListQuerySchema = z.object({
  contactId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** "CN/2026-27/0001" */
export const creditNoteNumber = (fiscalYearName: string, n: number) => invoiceNumber(fiscalYearName, n, 'CN');
