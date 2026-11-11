import { z } from 'zod';
import { invoiceLineSchema, MAX_INVOICE_LINES } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * The documents before an invoice: a quotation (an offer), a proforma invoice (asking for payment in advance; not a
 * tax invoice) and a sales order (the order confirmed). Each kind numbers on its own.
 */
export const QUOTE_KINDS = ['quote', 'proforma', 'sales_order', 'delivery_challan'] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];
const QUOTE_PREFIX: Record<QuoteKind, string> = { quote: 'QT', proforma: 'PI', sales_order: 'SO', delivery_challan: 'DC' };
export const QUOTE_TITLES: Record<QuoteKind, string> = { quote: 'Quotation', proforma: 'Proforma invoice', sales_order: 'Sales order', delivery_challan: 'Delivery challan' };

/**
 * Why goods move on a delivery challan rather than an invoice (CGST Rule 55): sent for job work, on approval or sale
 * or return, to another branch, to an exhibition, goods whose quantity is known only on delivery (liquid gas), or
 * other movements that aren't a supply.
 */
export const CHALLAN_PURPOSES = ['job_work', 'approval', 'branch_transfer', 'exhibition', 'unknown_quantity', 'other'] as const;
export type ChallanPurpose = (typeof CHALLAN_PURPOSES)[number];
export const CHALLAN_PURPOSE_TEXT: Record<ChallanPurpose, string> = {
  job_work: 'Goods sent for job work (section 143)',
  approval: 'Goods sent on approval or sale or return',
  branch_transfer: 'Transfer to another place of business',
  exhibition: 'Goods sent for exhibition',
  unknown_quantity: 'Supply where the quantity is known only on delivery',
  other: 'Movement other than by way of supply',
};


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
    /** A quotation, proforma invoice or sales order */
    kind: z.enum(QUOTE_KINDS).optional().default('quote'),
    /** A delivery challan's reason (Rule 55) */
    purpose: z.enum(CHALLAN_PURPOSES).nullable().optional().default(null),
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
  .refine((v) => v.expiryDate >= v.quoteDate, { path: ['expiryDate'], message: 'The quote can’t expire before its date.' })
  .refine((v) => v.kind !== 'delivery_challan' || !!v.purpose, { path: ['purpose'], message: 'Say why the goods are moving.' });
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
  kind: z.enum(QUOTE_KINDS).optional(),
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

export const quoteNumber = (n: number, kind: QuoteKind = 'quote') => `${QUOTE_PREFIX[kind]}-${String(n).padStart(4, '0')}`;
/** "PI-0012" → its kind and serial, for search */
export function parseQuoteNumber(text: string): { kind: QuoteKind | null; number: number } | null {
  const m = /^(?:(QT|PI|SO)-)?(\d+)$/i.exec(text.trim());
  if (!m) return null;
  const kind = m[1] ? ((Object.entries(QUOTE_PREFIX).find(([, p]) => p === m[1]!.toUpperCase())?.[0] as QuoteKind) ?? null) : null;
  return { kind, number: Number(m[2]) };
}

/** Copying one into another kind: a quote accepted becomes a sales order or a proforma */
export const quoteCopySchema = z.object({ kind: z.enum(QUOTE_KINDS) });

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
