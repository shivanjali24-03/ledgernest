import { isUpiId } from '../upi/index.js';
import { z } from 'zod';
import { emailSchema } from '../auth/index.js';

/** True for an IANA time zone this runtime knows, e.g. "Asia/Kolkata". */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** True for an ISO 4217 currency code, e.g. "INR". */
export function isCurrency(value: string): boolean {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: value }).resolvedOptions().currency === value;
  } catch {
    return false;
  }
}

/** Default time zone for a country, for new organisations. Falls back to UTC. */
export const DEFAULT_TIME_ZONES: Record<string, string> = {
  IN: 'Asia/Kolkata',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  SG: 'Asia/Singapore',
  GB: 'Europe/London',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  ES: 'Europe/Madrid',
  US: 'America/New_York',
  AU: 'Australia/Sydney',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => v || null)
    .nullable();

export const addressSchema = z.object({
  line1: optionalText(120),
  line2: optionalText(120),
  city: optionalText(80),
  region: optionalText(80),
  postalCode: optionalText(16),
});
export type Address = z.output<typeof addressSchema>;

/** What an organisation's Owner or Admin may change about it. The web address (slug) stays with Super Admins. */
export const organizationSettingsSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter at least 2 characters.').max(120, 'Keep it under 120 characters.'),
    legalName: optionalText(160),
    /** GSTIN, VAT number, EIN… Letters, digits, spaces, dots, dashes and slashes */
    taxId: z
      .string()
      .trim()
      .toUpperCase()
      .max(32, 'Keep it under 32 characters.')
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
      .regex(/^$|^\+?[0-9][0-9 ()-]{5,19}$/, 'Use digits, spaces, brackets or dashes, optionally starting with +.')
      .transform((v) => v || null)
      .nullable(),
    address: addressSchema.partial(),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, like IN.')
      .nullable(),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCurrency, 'Use a 3-letter currency code, like INR.'),
    /** Formats numbers and dates, e.g. "en-IN", "hi-IN", "ar-AE" */
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a locale like en-IN.'),
    timeZone: z.string().trim().refine(isTimeZone, 'Choose a time zone from the list.'),
    /** 1 = January … 4 = April (India) */
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    /** Printed at the foot of invoices and quotes: payment terms, bank details */
    invoiceTerms: optionalText(1000),
    /** UPI ID for the pay-by-UPI QR code on invoices, like sharmatraders@okhdfcbank */
    upiId: z
      .string()
      .trim()
      .max(320)
      .transform((v) => v || null)
      .refine((v) => v === null || isUpiId(v), 'Enter a UPI ID like yourname@okhdfcbank.')
      .nullable(),
    /** Email Owners and Admins a summary every Monday morning */
    weeklySummary: z.boolean(),
    /** Every member must use two-factor sign-in to open this organisation */
    requireTwoFactor: z.boolean(),
    /** This business's own MSME category (Udyam): micro and small may charge buyers interest for paying late */
    msmeCategory: z.enum(['micro', 'small', 'medium']).nullable(),
    udyamNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^$|^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'A Udyam number looks like UDYAM-MH-26-0012345.')
      .transform((v) => v || null)
      .nullable(),
    /** The RBI bank rate in basis points (550 = 5.50%), for MSMED Act interest at three times it */
    msmeBankRateBp: z.number().int().min(1).max(2000).nullable(),
    /** Regular GST, or the composition scheme (no GST charged; bills of supply; CMP-08 and GSTR-4) */
    gstScheme: z.enum(['regular', 'composition']),
    /** The composition rate in basis points: 1% traders and manufacturers, 5% restaurants, 6% services */
    compositionRateBp: z.union([z.literal(100), z.literal(500), z.literal(600)]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
export type OrganizationSettingsUpdate = z.output<typeof organizationSettingsSchema>;

/** Deleting the organisation: its name typed out, so it can't happen by a slip */
export const organizationDeleteSchema = z.object({ confirmName: z.string().trim().min(1, 'Type the organisation’s name.').max(200) });
export type OrganizationDeleteInput = z.infer<typeof organizationDeleteSchema>;

/** Logos: small raster images only. SVG is refused because it can carry scripts. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
export const LOGO_MAX_BYTES = 256 * 1024;

export const logoUploadSchema = z.object({
  type: z.enum(LOGO_TYPES, 'Use a PNG, JPEG or WebP image.'),
  /** Base64 file contents (no data: prefix) */
  data: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The image could not be read.')
    .max(Math.ceil(LOGO_MAX_BYTES / 3) * 4, 'Use an image under 256 KB.'),
});
export type LogoUpload = z.infer<typeof logoUploadSchema>;

/** Checks a file's first bytes really are the image type it claims to be. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
