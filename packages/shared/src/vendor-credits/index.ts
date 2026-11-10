import { z } from 'zod';
import { invoiceNumber, parseQuantity } from '../invoices/index.js';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Debit notes to vendors: goods sent back or a price cut, some of a bill's lines credited with their input tax. The
 * credit comes off the bill; any more stays with the vendor for their other bills, or they refund it.
 */
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

export const vendorCreditSchema = z.object({
  billId: z.uuid(),
  date: isoDaySchema,
  /** The supplier's own credit note number, when they sent one (it shows in GSTR-2B) */
  vendorReference: text(64),
  /** The number series to number it from; omitted = the default */
  seriesId: z.uuid().nullable().optional().default(null),
  reason: text(500),
  lines: z
    .array(
      z.object({
        billLineId: z.uuid(),
        quantity: z
          .string()
          .trim()
          .refine((q) => (parseQuantity(q) ?? 0n) > 0n, 'Enter a quantity above 0.'),
      }),
    )
    .min(1, 'Credit at least one line.'),
});
export type VendorCreditInput = z.input<typeof vendorCreditSchema>;

/** Puts some of a debit note's remaining credit onto another of the vendor's bills */
export const vendorCreditApplySchema = z.object({ billId: z.uuid(), amount, date: isoDaySchema.optional() });
export type VendorCreditApplyInput = z.input<typeof vendorCreditApplySchema>;

/** The vendor pays some of the remaining credit back */
export const vendorCreditRefundSchema = z.object({ date: isoDaySchema, bankAccountId: z.uuid(), amount, reference: text(100) });
export type VendorCreditRefundInput = z.input<typeof vendorCreditRefundSchema>;

export const vendorCreditVoidSchema = z.object({ date: isoDaySchema.optional(), reason: z.string().trim().max(500).optional() });

export const vendorCreditListQuerySchema = z.object({
  contactId: z.uuid().optional(),
  billId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** "DN/2026-27/0001": a debit note, as Indian businesses call what they raise on a supplier */
export const vendorCreditNumber = (fiscalYearName: string, n: number) => invoiceNumber(fiscalYearName, n, 'DN');
