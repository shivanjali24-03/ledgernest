import { z } from 'zod';

/**
 * TDS (tax deducted at source) on payments to vendors, as India's Income-tax Act has it: the business keeps back a
 * share of what it pays a contractor, professional or landlord, pays it to the government by the 7th of the next
 * month, and files it quarterly (Form 26Q). The bill is settled in full; the bank pays the rest.
 *
 * The usual rates (from 1 October 2024) are suggested; the person paying picks what applies, as thresholds, PAN
 * and lower-deduction certificates change the rate.
 */
export const TDS_SECTIONS = [
  { code: '194C', rates: [{ key: 'individual', ppm: 10_000 }, { key: 'other', ppm: 20_000 }] },
  { code: '194J', rates: [{ key: 'professional', ppm: 100_000 }, { key: 'technical', ppm: 20_000 }] },
  { code: '194I', rates: [{ key: 'building', ppm: 100_000 }, { key: 'machinery', ppm: 20_000 }] },
  { code: '194H', rates: [{ key: 'standard', ppm: 20_000 }] },
  { code: '194Q', rates: [{ key: 'standard', ppm: 1_000 }] },
  { code: '194A', rates: [{ key: 'standard', ppm: 100_000 }] },
] as const;
export type TdsSection = (typeof TDS_SECTIONS)[number]['code'];
export const TDS_SECTION_CODES = TDS_SECTIONS.map((s) => s.code) as [TdsSection, ...TdsSection[]];

/** The TDS on an amount at a rate (parts per million), rounded to the rupee as returns are filed */
export const tdsOn = (base: number, ratePpm: number) => Math.round((base * ratePpm) / 1_000_000 / 100) * 100;

/** The PAN inside a GSTIN (characters 3 to 12), which Form 26Q needs for each deductee */
export const panFromGstin = (gstin: string | null | undefined) => (gstin && /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]{3}$/.test(gstin.toUpperCase()) ? gstin.toUpperCase().slice(2, 12) : null);

export const tdsSchema = z
  .object({
    section: z.enum(TDS_SECTION_CODES, 'Choose a TDS section.'),
    /** 10% = 100000 */
    ratePpm: z.number().int().min(1).max(300_000),
    /** What it's worked out on: the bills before GST (paise) */
    base: z.number().int().positive(),
    /** Kept back (paise) */
    amount: z.number().int().positive(),
    /** The liability account it's owed to the government on, e.g. TDS payable */
    accountId: z.uuid(),
  })
  .nullable()
  .optional()
  .default(null);
export type TdsInput = z.output<typeof tdsSchema>;

export const tdsReportQuerySchema = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'The start comes after the end.' });
