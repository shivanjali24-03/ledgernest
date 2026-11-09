import { z } from 'zod';
import { rateSchema } from '../currencies/index.js';
import { invoiceLineSchema, MAX_INVOICE_LINES } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Purchase bills: what vendors bill you. They mirror invoices: the same lines and tax maths (see invoiceAmounts),
 * posted the other way round: expenses or assets and input tax credit against what's owed to the vendor.
 */
export const BILL_STATUSES = ['draft', 'open', 'void'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillState = 'draft' | 'open' | 'partly_paid' | 'paid' | 'overdue' | 'void';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

/** A bill line: as an invoice line, but its account is an expense or an asset (e.g. equipment) */
export const billLineSchema = invoiceLineSchema;

export const billDraftSchema = z
  .object({
    contactId: z.uuid(),
    /** The vendor's own bill number, as printed on their bill */
    vendorReference: text(64),
    billDate: isoDaySchema,
    /** Omitted = the bill date plus the vendor's payment terms */
    dueDate: isoDaySchema.nullable().optional().default(null),
    notes: text(1000),
    /** GST state code where the supply is received from (the vendor's state); omitted = the vendor's */
    placeOfSupply: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    payableAccountId: z.uuid().nullable().optional().default(null),
    rate: rateSchema.nullable().optional().default(null),
    lines: z.array(billLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.billDate, { path: ['dueDate'], message: 'The due date can’t be before the bill date.' });
export type BillDraftInput = z.input<typeof billDraftSchema>;

export const billListQuerySchema = z.object({
  state: z.enum(['draft', 'open', 'partly_paid', 'paid', 'overdue', 'void', 'unpaid']).optional(),
  contactId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const billVoidSchema = z.object({ date: isoDaySchema.optional(), reason: z.string().trim().max(500).optional() });

/** "BILL/2026-27/0004" */
export const billNumber = (fiscalYearName: string, n: number) => `BILL/${fiscalYearName.replace(/^FY\s*/, '').replace('–', '-')}/${String(n).padStart(4, '0')}`;

export function billState(b: { status: BillStatus; total: number; amountPaid: number; dueDate: string }, today: string): BillState {
  if (b.status !== 'open') return b.status;
  if (b.amountPaid >= b.total) return 'paid';
  if (b.dueDate < today) return 'overdue';
  return b.amountPaid > 0 ? 'partly_paid' : 'open';
}
