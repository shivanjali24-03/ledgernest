import { z } from 'zod';
import { bankDetailsSchema } from '../bank/index.js';
import { emailSchema } from '../auth/index.js';
import { findIndianState, isGstin } from '../taxes/index.js';
import { TDS_SECTION_CODES } from '../tds/index.js';

/**
 * Customers and vendors. One contact can be both (a business you sell to and buy from).
 * For India, a GSTIN is checked (format and check character) and its first two digits give the state,
 * which decides CGST + SGST or IGST on invoices (the place of supply).
 */
export const PAYMENT_TERMS_MAX_DAYS = 365;

const contactPan = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v || null)
  .refine((v) => v === null || /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(v), 'A PAN looks like ABCPK1234F.')
  .nullable();

/**
 * How GST treats a party: registered (regular GSTIN), composition (registered, but can't charge GST or claim credit),
 * an SEZ unit or developer (supplies to it are zero-rated), unregistered business, consumer, overseas (exports and
 * imports), or a UN body or embassy with a UIN. null = worked out from the GSTIN and country (gstTreatmentOf).
 */
export const GST_TREATMENTS = ['registered', 'composition', 'sez', 'unregistered', 'consumer', 'overseas', 'uin'] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];
/** The treatments that come with a GSTIN (or UIN) */
export const GSTIN_TREATMENTS: readonly GstTreatment[] = ['registered', 'composition', 'sez', 'uin'];

/** MSME categories under the MSMED Act (Udyam registration); micro and small suppliers must be paid within 45 days */
export const MSME_CATEGORIES = ['micro', 'small', 'medium'] as const;
export type MsmeCategory = (typeof MSME_CATEGORIES)[number];
/** A Udyam registration number: UDYAM-MH-26-0012345 */
export const UDYAM_NUMBER = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const udyam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^$|^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'A Udyam number looks like UDYAM-MH-26-0012345.')
  .transform((v) => v || null)
  .nullable();

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

const contactAddress = z.object({
  line1: text(120),
  line2: text(120),
  city: text(80),
  /** State, province or emirate */
  region: text(80),
  postalCode: text(16),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[A-Z]{2}$/, 'Use a 2-letter country code, like IN.')
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
});

const phoneField = z
  .string()
  .trim()
  .max(32)
  .regex(/^$|^\+?[0-9 ()-]{6,}$/, 'Use digits, spaces, brackets or dashes, optionally starting with +.')
  .transform((v) => v || null)
  .nullable();

/** Someone to deal with at a customer or vendor */
export const contactPersonSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(120),
  designation: text(80),
  email: z
    .union([z.literal(''), emailSchema])
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  phone: phoneField.optional().default(null),
  whatsapp: phoneField.optional().default(null),
  /** The one documents go to first */
  primary: z.boolean().optional().default(false),
});
export type ContactPerson = z.output<typeof contactPersonSchema>;

/** A delivery address with its name: "Chakan plant", "Bhiwandi warehouse" */
export const shipAddressSchema = contactAddress.extend({ label: z.string().trim().min(1, 'Name the address.').max(60) });
export type ShipAddress = z.output<typeof shipAddressSchema>;
export type ContactAddress = z.output<typeof contactAddress>;

const fields = {
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(160, 'Keep it under 160 characters.'),
  isCustomer: z.boolean(),
  isVendor: z.boolean(),
  legalName: text(160),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .max(32, 'Keep it under 32 characters.')
    .regex(/^$|^[A-Z0-9][A-Z0-9 ./-]*$/, 'Use letters, numbers, spaces, dots, dashes or slashes.')
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  email: z
    .union([z.literal(''), emailSchema])
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^$|^\+?[0-9 ()-]{6,}$/, 'Use digits, spaces, brackets or dashes, optionally starting with +.')
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  billingAddress: contactAddress.optional().default({ line1: null, line2: null, city: null, region: null, postalCode: null, country: null }),
  /** null = same as billing */
  shippingAddress: contactAddress.nullable().optional().default(null),
  /** Invoices and bills in this currency by default; null = the base currency */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional()
    .default(null),
  paymentTermsDays: z.number().int().min(0).max(PAYMENT_TERMS_MAX_DAYS).optional().default(30),
  /** The most a customer may owe, in their currency's smallest unit; null = no limit */
  creditLimit: z.number().int().min(0).max(1e15).nullable().optional().default(null),
  /** The vendor's MSME category from its Udyam certificate; null = not an MSME (or not known) */
  msmeCategory: z.enum(MSME_CATEGORIES).nullable().optional().default(null),
  udyamNumber: udyam.optional().default(null),
  /** Interest on this customer's late payments, basis points a year: null = the organisation's, 0 = none */
  interestRateBp: z.number().int().min(0).max(3600).nullable().optional().default(null),
  /** How GST treats them; null = worked out from the GSTIN and country */
  gstTreatment: z.enum(GST_TREATMENTS).nullable().optional().default(null),
  /** Their PAN, for TDS (from the GSTIN when blank) */
  pan: contactPan.optional().default(null),
  /** The account they're paid into (vendors) */
  bankDetails: bankDetailsSchema.nullable().optional().default(null),
  /** The number to WhatsApp them on, when it isn't the phone */
  whatsapp: phoneField.optional().default(null),
  /** People to deal with there */
  persons: z.array(contactPersonSchema).max(10, 'Keep it to 10 people.').optional().default([]),
  /** More places goods go to (sites, branches, warehouses), each with a label */
  shipAddresses: z.array(shipAddressSchema).max(20, 'Keep it to 20 addresses.').optional().default([]),
  /** The TDS section their payments usually fall under (vendors) */
  tdsSection: z.enum(TDS_SECTION_CODES).nullable().optional().default(null),
  /** Plies, hires or leases goods carriages (vendors): cash paid to them may go to ₹35,000 a day, not ₹10,000 */
  goodsTransporter: z.boolean().optional().default(false),
  notes: text(1000),
};

/** A GSTIN needs an Indian address; it fixes the state, which must agree with the one typed (if any). */
function checkGstin(v: { taxId: string | null; billingAddress: ContactAddress; gstTreatment?: GstTreatment | null; pan?: string | null; persons?: { primary: boolean }[] }, ctx: z.RefinementCtx) {
  if ((v.persons ?? []).filter((p) => p.primary).length > 1) ctx.addIssue({ code: 'custom', path: ['persons'], message: 'Only one person can be the main contact.' });
  if (v.pan && v.taxId && isGstin(v.taxId) && v.taxId.slice(2, 12) !== v.pan) ctx.addIssue({ code: 'custom', path: ['pan'], message: `The GSTIN carries PAN ${v.taxId.slice(2, 12)}.` });
  const t = v.gstTreatment;
  if (t && GSTIN_TREATMENTS.includes(t) && !v.taxId) ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'Give their GSTIN (or UIN).' });
  if ((t === 'unregistered' || t === 'consumer') && v.taxId && isGstin(v.taxId)) ctx.addIssue({ code: 'custom', path: ['gstTreatment'], message: 'They have a GSTIN, so they’re registered.' });
  if (t === 'overseas' && v.billingAddress.country === 'IN') ctx.addIssue({ code: 'custom', path: ['billingAddress', 'country'], message: 'An overseas party has an address outside India.' });
  if (!v.taxId || v.billingAddress.country !== 'IN') return;
  if (!isGstin(v.taxId)) return void ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'This GSTIN isn’t valid: check the 15 characters.' });
  const typed = findIndianState(v.billingAddress.region);
  if (typed && typed.code !== v.taxId.slice(0, 2)) ctx.addIssue({ code: 'custom', path: ['billingAddress', 'region'], message: 'The GSTIN is registered in a different state.' });
}

export const contactCreateSchema = z
  .object(fields)
  .refine((v) => v.isCustomer || v.isVendor, { path: ['isCustomer'], message: 'A contact is a customer, a vendor or both.' })
  .superRefine(checkGstin);
export type ContactCreateInput = z.input<typeof contactCreateSchema>;

export const contactUpdateSchema = z
  .object({
    name: fields.name,
    isCustomer: z.boolean(),
    isVendor: z.boolean(),
    legalName: fields.legalName.unwrap().unwrap(),
    taxId: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .regex(/^$|^[A-Z0-9][A-Z0-9 ./-]*$/, 'Use letters, numbers, spaces, dots, dashes or slashes.')
      .transform((v) => v || null)
      .nullable(),
    email: z
      .union([z.literal(''), emailSchema])
      .transform((v) => v || null)
      .nullable(),
    phone: z
      .string()
      .trim()
      .max(32)
      .regex(/^$|^\+?[0-9 ()-]{6,}$/, 'Use digits, spaces, brackets or dashes, optionally starting with +.')
      .transform((v) => v || null)
      .nullable(),
    billingAddress: contactAddress,
    shippingAddress: contactAddress.nullable(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    paymentTermsDays: z.number().int().min(0).max(PAYMENT_TERMS_MAX_DAYS),
    creditLimit: z.number().int().min(0).max(1e15).nullable(),
    msmeCategory: z.enum(MSME_CATEGORIES).nullable(),
    udyamNumber: udyam,
    interestRateBp: z.number().int().min(0).max(3600).nullable(),
    gstTreatment: z.enum(GST_TREATMENTS).nullable(),
    pan: contactPan,
    bankDetails: bankDetailsSchema.nullable(),
    whatsapp: phoneField,
    persons: z.array(contactPersonSchema).max(10, 'Keep it to 10 people.'),
    shipAddresses: z.array(shipAddressSchema).max(20, 'Keep it to 20 addresses.'),
    tdsSection: z.enum(TDS_SECTION_CODES).nullable(),
    goodsTransporter: z.boolean(),
    notes: z
      .string()
      .trim()
      .max(1000)
      .transform((v) => v || null)
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

/** How GST treats a contact: as set, or from its GSTIN and country */
export function gstTreatmentOf(c: { gstTreatment?: GstTreatment | string | null; taxId: string | null; billingAddress?: { country: string | null } | null }): GstTreatment {
  if (c.gstTreatment && (GST_TREATMENTS as readonly string[]).includes(c.gstTreatment)) return c.gstTreatment as GstTreatment;
  if (c.taxId && isGstin(c.taxId)) return 'registered';
  if (c.billingAddress?.country && c.billingAddress.country !== 'IN') return 'overseas';
  return 'unregistered';
}

/** The state a contact's supplies are taxed in: from the GSTIN when there is one, else the address. */
export function contactStateCode(c: { taxId: string | null; billingAddress: { region: string | null; country: string | null } }): string | null {
  if (c.taxId && isGstin(c.taxId)) return c.taxId.slice(0, 2);
  if (c.billingAddress.country && c.billingAddress.country !== 'IN') return null;
  return findIndianState(c.billingAddress.region)?.code ?? null;
}

export const contactListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  type: z.enum(['customer', 'vendor']).optional(),
  archived: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
