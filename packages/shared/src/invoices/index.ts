import { z } from 'zod';
import { batchLabel } from '../inventory/batches.js';
import { serialsSchema } from '../inventory/serials.js';
import { instalmentStatus, instalmentsSchema, type Instalment } from './instalments.js';
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
/** A discount on the whole invoice: a percentage (parts per million, 50_000 = 5%) or a flat amount (smallest unit) */
export interface InvoiceDiscount {
  kind: 'percent' | 'amount';
  value: number;
}

/**
 * Line amounts, subtotal, tax and total.
 * - `taxInclusive`: prices include GST, which is taken out of each line (the total is what the prices add up to).
 * - `discount`: a discount on the whole invoice, spread over the lines by value before tax, so it lowers the
 *   taxable value as GST allows for a discount given on the invoice; the paise left over go to the largest lines.
 * - `roundTo` (e.g. 100 paise): the total rounded to the nearest whole rupee, half up, the difference kept as the
 *   round-off.
 */
export function invoiceAmounts(
  lines: readonly { quantity: string; unitPrice: number; discountPpm: number; rates: readonly TaxComponent[] }[],
  opts: { roundTo?: number; taxInclusive?: boolean; discount?: InvoiceDiscount | null } = {},
) {
  const values = lines.map((l) => lineNet(l.quantity, l.unitPrice, l.discountPpm));
  const before = values.reduce((s, v) => s + v, 0);
  // The invoice discount, line by line
  const cut = values.map(() => 0);
  const d = opts.discount;
  if (d && d.value > 0 && before > 0) {
    const wanted = d.kind === 'percent' ? Math.round((before * Math.min(d.value, 1_000_000)) / 1_000_000) : Math.min(d.value, before);
    const exact = values.map((v) => (wanted * v) / before);
    exact.forEach((x, n) => (cut[n] = Math.floor(x)));
    let left = wanted - cut.reduce((s, x) => s + x, 0);
    for (const n of exact.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f).map((x) => x.i)) {
      if (left <= 0) break;
      cut[n]!++;
      left--;
    }
  }
  const out: InvoiceLineAmounts[] = lines.map((l, n) => {
    const value = values[n]! - cut[n]!;
    const { net, taxes } = splitTax(value, !!opts.taxInclusive, l.rates);
    return { net, taxes, tax: taxes.reduce((s, t) => s + t.amount, 0) };
  });
  const subtotal = out.reduce((s, l) => s + l.net, 0);
  const tax = out.reduce((s, l) => s + l.tax, 0);
  const raw = subtotal + tax;
  const step = opts.roundTo && opts.roundTo > 1 ? opts.roundTo : 0;
  const total = step ? Math.floor((raw + step / 2) / step) * step : raw;
  /** discount: the invoice discount (in the prices' own terms: with tax when they include it) */
  return { lines: out, subtotal, tax, roundOff: total - raw, total, discount: cut.reduce((s, x) => s + x, 0), beforeDiscount: before };
}

export const invoiceDiscountSchema = z.object({ kind: z.enum(['percent', 'amount']), value: z.number().int().min(1).max(1e15) }).refine((d) => d.kind !== 'percent' || d.value <= 1_000_000, 'A discount can’t be more than 100%.');

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
  /** For goods kept in batches: the batch to sell from; omitted = earliest expiry first */
  batchId: z.uuid().nullable().optional().default(null),
  /** For goods with serial numbers: the units sold (bought, on a bill), one per unit */
  serials: serialsSchema,
  /** The quantity and price are in the item's second unit (e.g. boxes), not its main one */
  inAltUnit: z.boolean().optional().default(false),
});
export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;

/**
 * The order and dispatch details a goods invoice usually carries in India: the buyer's order, the delivery note,
 * how and where the goods went (transporter, LR/RR number, vehicle), and the terms of delivery. All optional.
 */
export const dispatchSchema = z.object({
  buyerOrderNo: text(40),
  buyerOrderDate: z.preprocess((v) => (v === '' ? null : v), isoDaySchema.nullable().optional().default(null)),
  deliveryNote: text(40),
  dispatchDocNo: text(40),
  dispatchedThrough: text(80),
  destination: text(80),
  vehicleNo: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() || null : v), z.string().regex(/^[A-Z]{2}[0-9A-Z]{4,13}$/, 'Not a vehicle number.').nullable().optional().default(null)),
  termsOfDelivery: text(200),
});
export type DispatchDetails = z.output<typeof dispatchSchema>;
/** The details as lines for a printed invoice, leaving out what's blank */
export function dispatchLines(d: Partial<DispatchDetails> | null | undefined): string[] {
  if (!d) return [];
  const pairs: [string, string | null | undefined][] = [
    ["Buyer's order", [d.buyerOrderNo, d.buyerOrderDate && `dated ${d.buyerOrderDate}`].filter(Boolean).join(' ') || null],
    ['Delivery note', d.deliveryNote],
    ['Dispatch doc / LR no.', d.dispatchDocNo],
    ['Dispatched through', d.dispatchedThrough],
    ['Destination', d.destination],
    ['Vehicle', d.vehicleNo],
    ['Terms of delivery', d.termsOfDelivery],
  ];
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

/** A ship-to address on an invoice: who receives the goods there, and where */
export const shipToSchema = z.object({
  name: text(160),
  line1: text(120),
  line2: text(120),
  city: text(80),
  region: text(80),
  postalCode: text(16),
  country: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v), z.string().regex(/^[A-Z]{2}$/).nullable().optional().default(null)),
});
export type ShipTo = z.output<typeof shipToSchema>;

/**
 * What kind of supply an invoice is, for GST: an ordinary one, an export or a supply to an SEZ (zero-rated: with
 * IGST paid and claimed back, or without it under a letter of undertaking), or a deemed export.
 */
export const SUPPLY_KINDS = ['regular', 'export_with_igst', 'export_lut', 'sez_with_igst', 'sez_lut', 'deemed_export'] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];
export const zeroRatedUnderLut = (k: SupplyKind | string | null | undefined) => k === 'export_lut' || k === 'sez_lut';
export const isExport = (k: SupplyKind | string | null | undefined) => k === 'export_with_igst' || k === 'export_lut';
export const isSez = (k: SupplyKind | string | null | undefined) => k === 'sez_with_igst' || k === 'sez_lut';

/** An export's shipping bill: the port (6-character code), its number and date, and where the goods go */
export const exportDetailsSchema = z.object({
  portCode: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v), z.string().regex(/^[A-Z0-9]{6}$/, 'A port code has 6 letters or digits, like INNSA1.').nullable().optional().default(null)),
  shippingBillNo: text(20),
  shippingBillDate: z.preprocess((v) => (v === '' ? null : v), isoDaySchema.nullable().optional().default(null)),
  /** Two-letter country code of where the goods go */
  countryCode: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v), z.string().regex(/^[A-Z]{2}$/).nullable().optional().default(null)),
});
export type ExportDetails = z.output<typeof exportDetailsSchema>;

/** The declaration a zero-rated or export invoice must carry */
export function supplyDeclaration(kind: SupplyKind | string | null | undefined, lut?: { number: string | null } | null): string | null {
  const arn = lut?.number ? ` (LUT ${lut.number})` : '';
  switch (kind) {
    case 'export_lut':
      return `Supply meant for export under bond or letter of undertaking without payment of IGST${arn}.`;
    case 'export_with_igst':
      return 'Supply meant for export on payment of IGST.';
    case 'sez_lut':
      return `Supply to SEZ unit or developer for authorised operations under bond or letter of undertaking without payment of IGST${arn}.`;
    case 'sez_with_igst':
      return 'Supply to SEZ unit or developer for authorised operations on payment of IGST.';
    case 'deemed_export':
      return 'Deemed export.';
    default:
      return null;
  }
}

export const invoiceDraftSchema = z
  .object({
    contactId: z.uuid(),
    issueDate: isoDaySchema,
    /** Omitted = the issue date plus the customer's payment terms */
    dueDate: isoDaySchema.nullable().optional().default(null),
    /** The number series to number it from; omitted = the default */
    seriesId: z.uuid().nullable().optional().default(null),
    /** Paid in instalments: each one's day and amount, adding up to the total (the last is the due date) */
    instalments: instalmentsSchema.nullable().optional().default(null),
    /** An ordinary supply, an export or SEZ supply (with IGST or under LUT), or a deemed export */
    supplyKind: z.enum(SUPPLY_KINDS).optional().default('regular'),
    /** For an export: the shipping bill and where the goods go */
    exportDetails: exportDetailsSchema.nullable().optional().default(null),
    /** Prices include GST, which is taken out of each line */
    pricesIncludeTax: z.boolean().optional().default(false),
    /** A discount on the whole invoice, before tax */
    discount: invoiceDiscountSchema.nullable().optional().default(null),
    /** Interest on late payment for this invoice, basis points a year: null = the customer's or organisation's, 0 = none */
    interestRateBp: z.number().int().min(0).max(3600).nullable().optional().default(null),
    reference: text(64),
    notes: text(1000),
    /** Order and dispatch details (goods) */
    dispatch: dispatchSchema.nullable().optional().default(null),
    /** Where the goods go, when not the customer's billing address; its state is the usual place of supply */
    shipTo: shipToSchema.nullable().optional().default(null),
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

/** A payment reminder for an issued invoice with something still owed: to the customer's email unless another is given */
export const invoiceReminderSchema = z.object({
  email: z.email('Enter a valid email address.').optional(),
  message: z.string().trim().max(2000).optional(),
});
export type InvoiceReminderInput = z.input<typeof invoiceReminderSchema>;

/** Emailing an issued invoice as a PDF: to the customer's email unless another is given, with an optional note */
export const invoiceEmailSchema = invoiceReminderSchema;

/** An invoice's lines, tax by rate and totals as rows for the PDF (amounts in major units) */
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function invoiceRows(
  i: { currency: string; roundOff?: number; lines: { description: string; quantity: string; unitPrice: number; discount: number; amount: number; taxAmount: number; item: { hsnSac: string | null } | null; batches?: { batchNo: string; mfgDate: string | null; expiryDate: string | null; quantity: string }[]; serials?: string[] }[]; taxBreakdown: { name: string; amount: number }[]; subtotal: number; total: number; amountPaid: number; balance: number },
  digits: number,
): string[][] {
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  // Labels under Discount, amounts under Tax, so the number columns stay right-aligned
  const total = (label: string, minor: number) => ['', '', '', '', label, '', fmt(minor)];
  return [
    ['Description', 'HSN/SAC', 'Qty', `Price (${i.currency})`, 'Discount', 'Taxable value', 'Tax'],
    // Goods from batches: a row under the line for each batch, with its dates and how many came from it
    ...i.lines.flatMap((l) => [[l.description, l.item?.hsnSac ?? '', l.quantity, fmt(l.unitPrice), l.discount ? `${l.discount}%` : '', fmt(l.amount), fmt(l.taxAmount)], ...(l.batches ?? []).map((b) => [`   ${batchLabel(b)}`, '', b.quantity, '', '', '', '']), ...chunk(l.serials ?? [], 3).map((c) => [`   S/N ${c.join(', ')}`, '', '', '', '', '', ''])]),
    total('Subtotal', i.subtotal),
    ...i.taxBreakdown.map((t) => total(t.name, t.amount)),
    ...(i.roundOff ? [total('Round off', i.roundOff)] : []),
    total(`Total (${i.currency})`, i.total),
    ...(i.amountPaid ? [total('Paid', i.amountPaid), total('Balance due', i.balance)] : []),
  ];
}

/** Automatic payment reminders for overdue invoices */
export const reminderPolicySchema = z.object({
  enabled: z.boolean(),
  /** Days after the due date for the first one */
  firstAfterDays: z.number().int().min(0).max(90),
  /** Days between one reminder and the next */
  repeatEveryDays: z.number().int().min(1).max(90),
  /** At most this many per invoice, manual ones included */
  maxReminders: z.number().int().min(1).max(10),
});
export type ReminderPolicy = z.infer<typeof reminderPolicySchema>;
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = { enabled: false, firstAfterDays: 3, repeatEveryDays: 7, maxReminders: 3 };

/**
 * Whether an invoice is due an automatic reminder today: issued with something owed, past its due date by the
 * policy's days, under the limit, and long enough since the last one (manual or automatic).
 */
export function reminderDue(
  i: { status: string; balance: number; dueDate: string; reminders: number; lastRemindedAt: string | null },
  policy: ReminderPolicy,
  today: string,
): boolean {
  if (!policy.enabled || i.status !== 'issued' || i.balance <= 0 || i.reminders >= policy.maxReminders) return false;
  const late = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${i.dueDate}T00:00:00Z`)) / 86_400_000);
  if (late < Math.max(1, policy.firstAfterDays)) return false;
  if (!i.lastRemindedAt) return true;
  const since = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${i.lastRemindedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return since >= policy.repeatEveryDays;
}

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
export function invoiceState(i: { status: InvoiceStatus; total: number; amountPaid: number; dueDate: string; instalments?: Instalment[] | null }, today: string): InvoiceState {
  if (i.status !== 'issued') return i.status;
  if (i.amountPaid >= i.total) return 'paid';
  // Paid in instalments: overdue once an instalment past its day isn't covered
  if (i.instalments?.length) return instalmentStatus(i.instalments, i.amountPaid, today).some((x) => x.state === 'overdue') ? 'overdue' : i.amountPaid > 0 ? 'partly_paid' : 'issued';
  if (i.dueDate < today) return 'overdue';
  return i.amountPaid > 0 ? 'partly_paid' : 'issued';
}
export * from './instalments.js';

/** The copies of a goods invoice (CGST Rules, rule 48): marked at the top of each */
export const INVOICE_COPIES = {
  original: 'ORIGINAL FOR RECIPIENT',
  duplicate: 'DUPLICATE FOR TRANSPORTER',
  triplicate: 'TRIPLICATE FOR SUPPLIER',
} as const;
export type InvoiceCopy = keyof typeof INVOICE_COPIES;
export const invoiceCopyQuerySchema = z.object({ copy: z.enum(['original', 'duplicate', 'triplicate']).optional() });

/**
 * The HSN/SAC summary printed under a tax invoice: taxable value and tax for each code at each rate, as GST asks
 * invoices to show by HSN.
 */
export function hsnSummary(lines: readonly { amount: number; taxAmount: number; item: { hsnSac: string | null } | null; ratePct?: number | null }[]) {
  const by = new Map<string, { hsn: string; rate: number | null; taxable: number; tax: number }>();
  for (const l of lines) {
    const hsn = l.item?.hsnSac ?? '';
    if (!hsn) continue;
    const key = `${hsn}|${l.ratePct ?? ''}`;
    const x = by.get(key) ?? { hsn, rate: l.ratePct ?? null, taxable: 0, tax: 0 };
    x.taxable += l.amount;
    x.tax += l.taxAmount;
    by.set(key, x);
  }
  return [...by.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || (a.rate ?? 0) - (b.rate ?? 0));
}
