import { z } from 'zod';
import { batchDatesInOrder, batchFieldShape, BATCH_DATES_MESSAGE } from '../inventory/batches.js';
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
/** A bill line; goods kept in batches also say which batch came in, with its dates */
/**
 * Input tax credit on a bill line (CGST Act s.16-17): eligible; blocked under s.17(5) (motor vehicles, food and
 * beverages, club and health memberships, works contracts for immovable property, goods for personal use, gifts…);
 * or otherwise ineligible (used for exempt supplies or outside the business). Credit that isn't eligible is cost.
 */
export const ITC_KINDS = ['eligible', 'blocked', 'ineligible'] as const;
export type ItcKind = (typeof ITC_KINDS)[number];

export const billLineSchema = invoiceLineSchema
  .omit({ batchId: true })
  .extend(batchFieldShape)
  .extend({ itc: z.enum(ITC_KINDS).optional().default('eligible') })
  .refine(batchDatesInOrder, { path: ['expiryDate'], message: BATCH_DATES_MESSAGE });

/**
 * Goods imported: the bill of entry customs assessed them on (ICEGATE). Entered as a bill from customs (or the
 * clearing agent): taxed lines are the assessable value IGST is worked out on (owed to the overseas supplier on their
 * own bill, not here), untaxed lines are the duties (basic customs duty, social welfare surcharge). What's owed is the
 * duties plus the IGST; the IGST is input credit, the duties are cost.
 */
export const billOfEntrySchema = z.object({
  number: z.string().trim().regex(/^\d{6,8}$/, 'A bill of entry number is 6 to 8 digits.'),
  date: isoDaySchema,
  /** The customs port code, e.g. INNSA1 (Nhava Sheva) */
  portCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{4}$/, 'A port code is 6 letters and digits, e.g. INNSA1.'),
});
export type BillOfEntry = z.output<typeof billOfEntrySchema>;

export const billDraftSchema = z
  .object({
    contactId: z.uuid(),
    /** The vendor's own bill number, as printed on their bill */
    vendorReference: text(64),
    /** The date printed on the vendor's bill (GSTR-2B shows it); omitted = the bill date */
    vendorBillDate: isoDaySchema.nullable().optional().default(null),
    /** We pay the GST under reverse charge (e.g. transport from a GTA, legal services, or services bought from abroad): the vendor charges none */
    reverseCharge: z.boolean().optional().default(false),
    /** Goods imported: the bill of entry (see billOfEntrySchema) */
    billOfEntry: billOfEntrySchema.nullable().optional().default(null),
    /** When the bill is entered in the books */
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
    /** The warehouse its goods leave or come into (once there are warehouses); null = the main one */
    warehouseId: z.uuid().nullable().optional().default(null),
    /** The GST registration (GSTIN) it's under; null = the organisation's own */
    gstRegistrationId: z.uuid().nullable().optional().default(null),
    payableAccountId: z.uuid().nullable().optional().default(null),
    rate: rateSchema.nullable().optional().default(null),
    lines: z.array(billLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.billDate, { path: ['dueDate'], message: 'The due date can’t be before the bill date.' })
  .refine((v) => !v.vendorBillDate || v.vendorBillDate <= v.billDate, { path: ['vendorBillDate'], message: 'The vendor’s bill can’t be dated after it’s entered.' });
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
/** "BILL/2026-27/0001"; a bill brought in as owed when the books started (numbered below zero) is "OB/2026-27/0001" */
export const billNumber = (fiscalYearName: string, n: number) => `${n < 0 ? 'OB' : 'BILL'}/${fiscalYearName.replace(/^FY\s*/, '').replace('–', '-')}/${String(Math.abs(n)).padStart(4, '0')}`;

export function billState(b: { status: BillStatus; total: number; amountPaid: number; dueDate: string }, today: string): BillState {
  if (b.status !== 'open') return b.status;
  if (b.amountPaid >= b.total) return 'paid';
  if (b.dueDate < today) return 'overdue';
  return b.amountPaid > 0 ? 'partly_paid' : 'open';
}

/**
 * A vendor's bill number reduced to what identifies it, so "SOS/887", "sos 887" and "SOS-0887" are the same bill:
 * letters and digits only, lower case, without leading zeros in numbers.
 */
export const billReferenceKey = (ref: string | null | undefined) =>
  (ref ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(?<!\d)0+(?=\d)/g, '');

export interface BillLike {
  id: string;
  vendorReference: string | null;
  billDate: string;
  total: number;
}

/**
 * Other bills from the same vendor that may be this one entered twice: the same bill number (sure), or no number to go
 * by but the same total within three days (likely).
 */
export function possibleDuplicateBills<T extends BillLike>(bill: BillLike, others: readonly T[]): (T & { reason: 'reference' | 'amount' })[] {
  const key = billReferenceKey(bill.vendorReference);
  const near = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= 3 * 86_400_000;
  return others
    .filter((o) => o.id !== bill.id)
    .flatMap((o): (T & { reason: 'reference' | 'amount' })[] => {
      const theirs = billReferenceKey(o.vendorReference);
      if (key && theirs) return key === theirs ? [{ ...o, reason: 'reference' as const }] : [];
      return o.total === bill.total && near(o.billDate, bill.billDate) ? [{ ...o, reason: 'amount' as const }] : [];
    });
}
