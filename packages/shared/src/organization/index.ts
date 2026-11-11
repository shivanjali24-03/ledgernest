import { isUpiId } from '../upi/index.js';
import { z } from 'zod';
import { bankDetailsSchema } from '../bank/index.js';

const PAN = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;
const TAN = /^[A-Z]{4}\d{5}[A-Z]$/;
const CIN_OR_LLPIN = /^([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}|[A-Z]{3}-\d{4})$/;
/** Legal forms of business, and the 4th letter of a PAN that goes with each */
export const BUSINESS_TYPES = ['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'opc', 'huf', 'trust', 'society', 'cooperative', 'aop', 'government'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
const PAN_TYPE: Record<BusinessType, string> = { proprietorship: 'P', partnership: 'F', llp: 'F', private_limited: 'C', public_limited: 'C', opc: 'C', huf: 'H', trust: 'T', society: 'A', cooperative: 'A', aop: 'A', government: 'G' };
/** An optional identifier: trimmed, upper-cased, blank = none */
const idField = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/\s+/g, '') || null)
    .refine((v) => v === null || re.test(v), message)
    .nullable();
import { isoDaySchema } from '../periods/index.js';
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
    /** Interest on invoices paid late: the yearly rate in basis points (1800 = 18%); null = none */
    interestRateBp: z.number().int().min(1).max(3600).nullable(),
    /** Simple interest, or compounded every month */
    interestMethod: z.enum(['simple', 'monthly']),
    /** Days after the due date it may be paid without interest */
    interestGraceDays: z.number().int().min(0).max(365),
    /** On the 1st of each month, draft interest invoices for what's accrued and not yet charged */
    interestAutoRaise: z.boolean(),
    /** Round rupee invoice totals to the nearest rupee, showing the round-off */
    roundInvoiceTotals: z.boolean(),
    /** The letter of undertaking for exports and SEZ supplies without IGST: its ARN and the dates it covers */
    lutNumber: z.string().trim().toUpperCase().max(20).transform((v) => v || null).nullable(),
    lutFrom: isoDaySchema.nullable(),
    lutTo: isoDaySchema.nullable(),
    /** The kind of business, which the PAN's 4th letter must agree with */
    businessType: z.enum(BUSINESS_TYPES).nullable(),
    pan: idField(PAN, 'A PAN looks like AAPFN1234C.'),
    /** Tax deduction account number, for TDS returns and certificates */
    tan: idField(TAN, 'A TAN looks like PNEN12345A.'),
    /** The company's CIN, or an LLP's LLPIN: companies print it on invoices (Companies Act s.12(3)(c)) */
    cin: idField(CIN_OR_LLPIN, 'A CIN looks like U72200MH2020PTC123456; an LLPIN like AAB-1234.'),
    /** Importer-exporter code from DGFT (now the PAN for most) */
    iec: idField(/^[A-Z0-9]{10}$/, 'An IEC is 10 letters and digits.'),
    /** The account customers pay into, printed on invoices */
    bankDetails: bankDetailsSchema.nullable(),
    /** Who signs invoices for the business, printed under the signature */
    signatoryName: optionalText(120),
    signatoryDesignation: optionalText(80),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type OrganizationSettingsInput = z.input<typeof organizationSettingsSchema>;
export type OrganizationSettingsUpdate = z.output<typeof organizationSettingsSchema>;


/**
 * Cross-checks of the organisation's identifiers: a GSTIN carries the PAN (characters 3-12); the PAN's 4th letter
 * is the kind of holder (C company, F firm or LLP, P person, H HUF, T trust, A AOP/society, G government); a CIN is for
 * companies (its last part says private, public or one person), an LLPIN for LLPs.
 */
export function organizationIdProblems(v: { pan?: string | null; taxId?: string | null; businessType?: BusinessType | null; cin?: string | null }): { field: 'pan' | 'cin'; message: string }[] {
  const out: { field: 'pan' | 'cin'; message: string }[] = [];
  const gstinPan = v.taxId && /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]{3}$/.test(v.taxId) ? v.taxId.slice(2, 12) : null;
  if (v.pan && gstinPan && v.pan !== gstinPan) out.push({ field: 'pan', message: `The GSTIN carries PAN ${gstinPan}.` });
  if (v.pan && v.businessType && v.pan[3] !== PAN_TYPE[v.businessType]) out.push({ field: 'pan', message: `A ${v.businessType.replace('_', ' ')}’s PAN has ${PAN_TYPE[v.businessType]} as its 4th letter.` });
  if (v.cin && v.businessType) {
    const llpin = /^[A-Z]{3}-\d{4}$/.test(v.cin);
    const company = ['private_limited', 'public_limited', 'opc'].includes(v.businessType);
    if (v.businessType === 'llp' ? !llpin : company ? llpin : true) out.push({ field: 'cin', message: v.businessType === 'llp' ? 'An LLP has an LLPIN, like AAB-1234.' : company ? 'A company has a 21-character CIN.' : 'Only companies and LLPs have a CIN or LLPIN.' });
    else if (company) {
      const kind = v.cin.slice(-9, -6);
      const want = v.businessType === 'private_limited' ? 'PTC' : v.businessType === 'opc' ? 'OPC' : 'PLC';
      if (kind !== want && !(v.businessType === 'public_limited' && ['PLC', 'GOI', 'SGC', 'GAP', 'NPL'].includes(kind))) out.push({ field: 'cin', message: `This CIN is for a ${kind} company.` });
    }
  }
  return out;
}

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

/** The signatory's signature and the business's seal, printed on invoices: PNG (best with a transparent background) or JPEG, which PDFs can hold */
export const SIGNATURE_IMAGES = ['signature', 'seal'] as const;
export type SignatureImage = (typeof SIGNATURE_IMAGES)[number];
export const signatureUploadSchema = logoUploadSchema.extend({ type: z.enum(['image/png', 'image/jpeg'], 'Use a PNG or JPEG image.') });
export type SignatureUpload = z.infer<typeof signatureUploadSchema>;

/** Checks a file's first bytes really are the image type it claims to be. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
