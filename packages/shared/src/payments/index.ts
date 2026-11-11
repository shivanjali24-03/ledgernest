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

/** How the money moved */
export const PAYMENT_MODES = ['cash', 'cheque', 'dd', 'neft', 'rtgs', 'imps', 'upi', 'card', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** The mode's details: a cheque or DD's number, date and bank; a bank transfer's UTR; a UPI reference */
const modeShape = {
  mode: z.enum(PAYMENT_MODES).nullable().optional().default(null),
  instrumentNo: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  instrumentDate: isoDaySchema.nullable().optional().default(null),
  /** The bank a cheque or DD is drawn on */
  drawnOn: text(80),
};

/** What the mode's details must look like */
export function paymentModeProblem(v: { mode: PaymentMode | null; instrumentNo: string | null; instrumentDate: string | null; date: string }): { field: 'instrumentNo' | 'instrumentDate'; message: string } | null {
  const no = v.instrumentNo;
  if (v.mode === 'cheque' || v.mode === 'dd') {
    if (!no || !/^\d{6}$/.test(no)) return { field: 'instrumentNo', message: `A ${v.mode === 'dd' ? 'demand draft' : 'cheque'} number is 6 digits.` };
    // A cheque is good for three months from its date (RBI)
    if (v.instrumentDate) {
      const months = (Date.parse(`${v.date}T00:00:00Z`) - Date.parse(`${v.instrumentDate}T00:00:00Z`)) / (86_400_000 * 30.44);
      if (months > 3) return { field: 'instrumentDate', message: 'The cheque is more than three months old: it can’t be presented.' };
    }
  }
  if ((v.mode === 'neft' || v.mode === 'rtgs' || v.mode === 'imps') && no && !/^[A-Z0-9]{10,22}$/.test(no)) return { field: 'instrumentNo', message: 'A UTR is 10 to 22 letters and digits.' };
  if (v.mode === 'upi' && no && !/^\d{12}$/.test(no)) return { field: 'instrumentNo', message: 'A UPI reference is 12 digits.' };
  return null;
}

/** "Cheque 123456 dated 05/10/2026 on HDFC Bank", "NEFT, UTR HDFCN52026101012345", "Cash" */
export function paymentModeText(v: { mode: PaymentMode | null; instrumentNo: string | null; instrumentDate: string | null; drawnOn: string | null }): string | null {
  if (!v.mode) return null;
  const label: Record<PaymentMode, string> = { cash: 'Cash', cheque: 'Cheque', dd: 'Demand draft', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', upi: 'UPI', card: 'Card', other: 'Other' };
  const day = (d: string) => d.split('-').reverse().join('/');
  if (v.mode === 'cheque' || v.mode === 'dd') return [label[v.mode], v.instrumentNo, v.instrumentDate && `dated ${day(v.instrumentDate)}`, v.drawnOn && `on ${v.drawnOn}`].filter(Boolean).join(' ');
  if (v.mode === 'neft' || v.mode === 'rtgs' || v.mode === 'imps') return v.instrumentNo ? `${label[v.mode]}, UTR ${v.instrumentNo}` : label[v.mode];
  if (v.mode === 'upi') return v.instrumentNo ? `UPI, reference ${v.instrumentNo}` : 'UPI';
  return v.instrumentNo ? `${label[v.mode]}, ${v.instrumentNo}` : label[v.mode];
}

/**
 * Cash limits in the Income-tax Act. s.269ST: nobody may receive ₹2,00,000 or more in cash from one person in a day,
 * or for one transaction (one invoice) — the penalty under s.271DA is the whole amount. s.40A(3): an expense paid in
 * cash to one person above ₹10,000 in a day (₹35,000 to a transporter) can't be deducted.
 */
export const CASH_RECEIPT_LIMIT = 2_00_000_00;
export const CASH_EXPENSE_LIMIT = 10_000_00;
export const CASH_EXPENSE_LIMIT_TRANSPORT = 35_000_00;

export type CashLimitBreach = { section: '269ST' | '40A(3)'; limit: number; total: number; basis: 'day' | 'invoice' };

/** Whether a cash receipt or payment crosses a limit, counting what the person already paid or was paid in cash */
export function cashLimitBreach(v: { kind: PaymentKind; amount: number; sameDay: number; perInvoice?: number[]; transporter?: boolean }): CashLimitBreach | null {
  if (v.kind === 'receipt') {
    const day = v.sameDay + v.amount;
    if (day >= CASH_RECEIPT_LIMIT) return { section: '269ST', limit: CASH_RECEIPT_LIMIT, total: day, basis: 'day' };
    const inv = Math.max(0, ...(v.perInvoice ?? []));
    if (inv >= CASH_RECEIPT_LIMIT) return { section: '269ST', limit: CASH_RECEIPT_LIMIT, total: inv, basis: 'invoice' };
    return null;
  }
  const limit = v.transporter ? CASH_EXPENSE_LIMIT_TRANSPORT : CASH_EXPENSE_LIMIT;
  const day = v.sameDay + v.amount;
  return day > limit ? { section: '40A(3)', limit, total: day, basis: 'day' } : null;
}

const modeCheck = (v: { mode: PaymentMode | null; instrumentNo: string | null; instrumentDate: string | null; date: string }, ctx: z.RefinementCtx) => {
  const p = paymentModeProblem(v);
  if (p) ctx.addIssue({ code: 'custom', path: [p.field], message: p.message });
};

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
    ...modeShape,
    /** Recorded although it crosses a cash limit (s.269ST, s.40A(3)): it happened, and the books say so */
    acknowledgeCashLimit: z.boolean().optional().default(false),
    notes: text(500),
    /** TDS the customer kept back and pays the government for you: claimed back against Form 26AS */
    tds: tdsSchema,
    allocations: z
      .array(z.object({ invoiceId: z.uuid(), amount }))
      .max(100)
      .default([])
      .refine((a) => new Set(a.map((x) => x.invoiceId)).size === a.length, 'Each invoice can appear once.'),
  })
  .refine((v) => v.allocations.reduce((s, a) => s + a.amount, 0) <= v.amount, { path: ['allocations'], message: 'You can’t allocate more than was received.' })
  .refine((v) => !v.tds || v.tds.amount < v.amount, { path: ['tds', 'amount'], message: 'TDS has to be less than the receipt.' })
  .superRefine(modeCheck);
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
    ...modeShape,
    /** Recorded although it crosses a cash limit (s.269ST, s.40A(3)): it happened, and the books say so */
    acknowledgeCashLimit: z.boolean().optional().default(false),
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
  .refine((v) => !v.tds || v.tds.amount < v.amount, { path: ['tds', 'amount'], message: 'TDS has to be less than the payment.' })
  .superRefine(modeCheck);
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
