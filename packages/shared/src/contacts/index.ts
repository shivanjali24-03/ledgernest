import { z } from 'zod';
import { emailSchema } from '../auth/index.js';
import { findIndianState, isGstin } from '../taxes/index.js';

/**
 * Customers and vendors. One contact can be both (a business you sell to and buy from).
 * For India, a GSTIN is checked (format and check character) and its first two digits give the state,
 * which decides CGST + SGST or IGST on invoices (the place of supply).
 */
export const PAYMENT_TERMS_MAX_DAYS = 365;

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
  notes: text(1000),
};

/** A GSTIN needs an Indian address; it fixes the state, which must agree with the one typed (if any). */
function checkGstin(v: { taxId: string | null; billingAddress: ContactAddress }, ctx: z.RefinementCtx) {
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
