import { tdsSchema } from '../tds/index.js';
import { z } from 'zod';
import { rateSchema } from '../currencies/index.js';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Money in from customers (receipts) and out to vendors (payments), allocated to the invoices or bills they
 * settle. Amounts are in the documents' currency; the bank account is in that currency or the base currency.
 * Whatever isn't allocated stays with the contact as credit (an advance).
 */
export const PAYMENT_KINDS = ['receipt', 'payment'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

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

export const receiptSchema = z
  .object({
    contactId: z.uuid(),
    date: isoDaySchema,
    /** The bank or cash account the money went into */
    bankAccountId: z.uuid(),
    /** In the invoices' currency (the customer's), smallest unit */
    amount,
    /** For a foreign currency: 1 unit in the base currency; omitted = the day's rate */
    rate: rateSchema.nullable().optional().default(null),
    reference: text(64),
    notes: text(500),
    allocations: z
      .array(z.object({ invoiceId: z.uuid(), amount }))
      .max(100)
      .default([])
      .refine((a) => new Set(a.map((x) => x.invoiceId)).size === a.length, 'Each invoice can appear once.'),
  })
  .refine((v) => v.allocations.reduce((s, a) => s + a.amount, 0) <= v.amount, { path: ['allocations'], message: 'You can’t allocate more than was received.' });
export type ReceiptInput = z.input<typeof receiptSchema>;

/** Money paid to a vendor, allocated to their open bills; the rest is an advance to them */
export const vendorPaymentSchema = z
  .object({
    contactId: z.uuid(),
    date: isoDaySchema,
    /** The bank or cash account the money left */
    bankAccountId: z.uuid(),
    amount,
    rate: rateSchema.nullable().optional().default(null),
    reference: text(64),
    notes: text(500),
    /** Tax deducted at source: kept back from the bank payment, owed to the government instead */
    tds: tdsSchema,
    allocations: z
      .array(z.object({ billId: z.uuid(), amount }))
      .max(100)
      .default([])
      .refine((a) => new Set(a.map((x) => x.billId)).size === a.length, 'Each bill can appear once.'),
  })
  .refine((v) => v.allocations.reduce((s, a) => s + a.amount, 0) <= v.amount, { path: ['allocations'], message: 'You can’t allocate more than was paid.' })
  .refine((v) => !v.tds || v.tds.amount < v.amount, { path: ['tds', 'amount'], message: 'TDS has to be less than the payment.' });
export type VendorPaymentInput = z.input<typeof vendorPaymentSchema>;

export const paymentVoidSchema = z.object({ reason: z.string().trim().max(500).optional() });

/** Allocates an amount to invoices oldest-due first, as a starting point the user can change. */
export function allocateOldestFirst(amount: number, open: readonly { id: string; dueDate: string; balance: number }[]): { invoiceId: string; amount: number }[] {
  let left = amount;
  const out: { invoiceId: string; amount: number }[] = [];
  for (const i of [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (left <= 0) break;
    const take = Math.min(left, i.balance);
    if (take > 0) out.push({ invoiceId: i.id, amount: take });
    left -= take;
  }
  return out;
}

/** "RCT/2026-27/0003" */
export const paymentNumber = (kind: PaymentKind, fiscalYearName: string, n: number) => `${kind === 'receipt' ? 'RCT' : 'PAY'}/${fiscalYearName.replace(/^FY\s*/, '').replace('–', '-')}/${String(n).padStart(4, '0')}`;
