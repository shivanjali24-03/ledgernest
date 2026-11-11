import { z } from 'zod';
import { invoiceLineSchema, MAX_INVOICE_LINES } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Quotes (estimates): priced like invoices, with the same lines and GST rules, but they post nothing. A quote is
 * drafted, sent, then accepted or declined; an accepted (or sent) one becomes a draft invoice with the same lines.
 * Past its expiry date an open quote shows as expired.
 */
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'invoiced'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export type QuoteState = QuoteStatus | 'expired';
/** Days a new quote stays open by default */
export const QUOTE_VALID_DAYS = 30;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const quoteDraftSchema = z
  .object({
    contactId: z.uuid(),
    quoteDate: isoDaySchema,
    expiryDate: isoDaySchema,
    reference: text(64),
    notes: text(1000),
    placeOfSupply: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    lines: z.array(invoiceLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => v.expiryDate >= v.quoteDate, { path: ['expiryDate'], message: 'The quote can’t expire before its date.' });
export type QuoteDraftInput = z.input<typeof quoteDraftSchema>;

/** Moving a quote on: sent, accepted or declined (or back to draft from sent) */
export const quoteStatusSchema = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'declined']) });

/** Turning a quote into a draft invoice, dated today unless another day is given */
export const quoteConvertSchema = z.object({ issueDate: isoDaySchema.optional() });

/** Emailing a quote as a PDF: to the customer's email unless another is given, with an optional note */
export const quoteEmailSchema = z.object({
  email: z.email('Enter a valid email address.').optional(),
  message: z.string().trim().max(2000).optional(),
});
export type QuoteEmailInput = z.input<typeof quoteEmailSchema>;

/** A quote's lines and totals as rows for the PDF (amounts in major units, e.g. rupees) */
export function quoteRows(q: { currency: string; lines: { description: string; quantity: string; unitPrice: number; discount: number; taxGroup: { name: string } | null; amount: number }[]; subtotal: number; taxTotal: number; total: number }, digits: number): string[][] {
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  return [
    ['Description', 'Qty', `Price (${q.currency})`, 'Discount', 'Tax', `Amount (${q.currency})`],
    ...q.lines.map((l) => [l.description, l.quantity, fmt(l.unitPrice), l.discount ? `${l.discount}%` : '', l.taxGroup?.name ?? '', fmt(l.amount)]),
    ['', '', '', '', 'Subtotal', fmt(q.subtotal)],
    ['', '', '', '', 'Tax', fmt(q.taxTotal)],
    ['', '', '', '', 'Total', fmt(q.total)],
  ];
}

export const quoteListQuerySchema = z.object({
  state: z.enum([...QUOTE_STATUSES, 'expired', 'open']).optional(),
  contactId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Which moves are allowed from each status */
export const QUOTE_MOVES: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'declined'],
  sent: ['draft', 'accepted', 'declined'],
  accepted: ['sent', 'declined'],
  declined: ['sent', 'accepted'],
  invoiced: [],
};

/** Draft and sent quotes can still be changed; the others are settled */
export const quoteEditable = (status: QuoteStatus) => status === 'draft' || status === 'sent';

/** What a quote shows as on a day: its status, or expired when an open one is past its expiry date */
export function quoteState(q: { status: QuoteStatus; expiryDate: string }, today: string): QuoteState {
  return (q.status === 'draft' || q.status === 'sent') && q.expiryDate < today ? 'expired' : q.status;
}

export const quoteNumber = (n: number) => `QT-${String(n).padStart(4, '0')}`;

/** A customer accepting or declining a quote from its link */
export const quoteDecisionSchema = z.object({
  response: z.enum(['accept', 'decline']),
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  note: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null)
    .nullish(),
});
export type QuoteDecisionInput = z.input<typeof quoteDecisionSchema>;
