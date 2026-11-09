import { z } from 'zod';
import { rateSchema } from '../currencies/index.js';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';
import { percentToPpm, splitTax, type TaxComponent } from '../taxes/index.js';

/**
 * Sales invoices. Amounts are in the invoice currency's smallest unit (the customer's currency, or the base
 * currency). Quantities have up to 4 decimals; a line's net amount is quantity × price less its discount,
 * rounded half up, and tax is added on top per line, each component rounded on its own (as GST invoices show).
 */
export const INVOICE_STATUSES = ['draft', 'issued', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** What a list shows: issued invoices are also paid, partly paid or overdue */
export type InvoiceState = 'draft' | 'issued' | 'partly_paid' | 'paid' | 'overdue' | 'void';
export const MAX_INVOICE_LINES = 200;

const QTY_SCALE = 10_000n;
const QTY_PATTERN = /^\d{1,9}(\.\d{1,4})?$/;

/** "2.5" → 25000n (quantity × 10^4); null if it isn't a positive quantity */
export function parseQuantity(text: string | number): bigint | null {
  const clean = String(text).trim();
  if (!QTY_PATTERN.test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  const q = BigInt(whole) * QTY_SCALE + BigInt(frac.padEnd(4, '0'));
  return q > 0n ? q : null;
}
/** 25000n → "2.5" */
export function formatQuantity(q: bigint | number): string {
  const v = BigInt(q);
  const frac = String(v % QTY_SCALE).padStart(4, '0').replace(/0+$/, '');
  return `${v / QTY_SCALE}${frac ? `.${frac}` : ''}`;
}

/** quantity × unit price − discount, rounded half up, in the smallest unit */
export function lineNet(quantity: string, unitPrice: number, discountPpm: number): number {
  const q = parseQuantity(quantity) ?? 0n;
  const gross = q * BigInt(unitPrice) * BigInt(1_000_000 - discountPpm);
  const den = QTY_SCALE * 1_000_000n;
  return Number((gross * 2n + den) / (den * 2n));
}

export interface InvoiceLineAmounts {
  net: number;
  taxes: { rateId: string; amount: number }[];
  tax: number;
}

/** Each line's net and tax, and the invoice's subtotal, tax and total. */
export function invoiceAmounts(lines: readonly { quantity: string; unitPrice: number; discountPpm: number; rates: readonly TaxComponent[] }[]) {
  const out: InvoiceLineAmounts[] = lines.map((l) => {
    const net = lineNet(l.quantity, l.unitPrice, l.discountPpm);
    const { taxes } = splitTax(net, false, l.rates);
    return { net, taxes, tax: taxes.reduce((s, t) => s + t.amount, 0) };
  });
  const subtotal = out.reduce((s, l) => s + l.net, 0);
  const tax = out.reduce((s, l) => s + l.tax, 0);
  return { lines: out, subtotal, tax, total: subtotal + tax };
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

export const invoiceLineSchema = z.object({
  itemId: z.uuid().nullable().optional().default(null),
  description: z.string().trim().min(1, 'Describe what was sold.').max(500),
  quantity: z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const q = parseQuantity(v);
      if (q === null) {
        ctx.addIssue({ code: 'custom', message: 'Enter a quantity above 0, with at most 4 decimals.' });
        return z.NEVER;
      }
      return formatQuantity(q);
    }),
  /** In the invoice currency's smallest unit */
  unitPrice: z.number().int().min(0).max(MAX_LINE_AMOUNT),
  /** A percentage, e.g. 10 or "2.5" */
  discount: z
    .union([z.string(), z.number()])
    .optional()
    .default(0)
    .transform((v, ctx) => {
      const ppm = percentToPpm(v);
      if (ppm === null) {
        ctx.addIssue({ code: 'custom', message: 'Enter a discount between 0 and 100%.' });
        return z.NEVER;
      }
      return ppm;
    }),
  taxGroupId: z.uuid().nullable().optional().default(null),
  /** The income account; defaults to the item's */
  accountId: z.uuid().nullable().optional().default(null),
  /** The cost centre or project the line belongs to */
  costCentreId: z.uuid().nullable().optional().default(null),
});
export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;

export const invoiceDraftSchema = z
  .object({
    contactId: z.uuid(),
    issueDate: isoDaySchema,
    /** Omitted = the issue date plus the customer's payment terms */
    dueDate: isoDaySchema.nullable().optional().default(null),
    reference: text(64),
    notes: text(1000),
    /** GST state code of the place of supply; omitted = the customer's state */
    placeOfSupply: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    /** The receivable account; omitted = the first active receivable in the invoice's currency */
    receivableAccountId: z.uuid().nullable().optional().default(null),
    /** For a foreign-currency invoice: 1 unit in the base currency; omitted = the rate on the issue date */
    rate: rateSchema.nullable().optional().default(null),
    lines: z.array(invoiceLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, { path: ['dueDate'], message: 'The due date can’t be before the issue date.' });
export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;

export const invoiceListQuerySchema = z.object({
  state: z.enum(['draft', 'issued', 'partly_paid', 'paid', 'overdue', 'void', 'unpaid']).optional(),
  contactId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  from: isoDaySchema.optional(),
  to: isoDaySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const invoiceVoidSchema = z.object({
  /** The day the reversal is dated; omitted = today */
  date: isoDaySchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

/** "INV/2026-27/0007" */
export const invoiceNumber = (fiscalYearName: string, n: number, prefix = 'INV') => `${prefix}/${fiscalYearName.replace(/^FY\s*/, '').replace('–', '-')}/${String(n).padStart(4, '0')}`;

/** The day a payment is due: the issue date plus the payment terms */
export function dueDateFor(issueDate: string, termsDays: number): string {
  const d = new Date(`${issueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + termsDays);
  return d.toISOString().slice(0, 10);
}

/** What an issued invoice is, given what's been paid and today's date */
export function invoiceState(i: { status: InvoiceStatus; total: number; amountPaid: number; dueDate: string }, today: string): InvoiceState {
  if (i.status !== 'issued') return i.status;
  if (i.amountPaid >= i.total) return 'paid';
  if (i.dueDate < today) return 'overdue';
  return i.amountPaid > 0 ? 'partly_paid' : 'issued';
}
