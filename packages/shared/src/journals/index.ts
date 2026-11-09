import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';
import { rateSchema } from '../currencies/index.js';

/**
 * Journal entries: the heart of double-entry. Every amount is an integer in the currency's
 * smallest unit (paise, cents), so totals never suffer floating-point rounding.
 */

/** The largest amount a line may hold: ₹ 10 lakh crore in paise, far beyond any small business, and safe as a JS number. */
export const MAX_LINE_AMOUNT = 1_000_000_000_000_000;
export const MAX_JOURNAL_LINES = 200;

const amount = z.number().int('Amounts are whole numbers of the smallest unit (e.g. paise).').min(0).max(MAX_LINE_AMOUNT);

export const journalLineSchema = z
  .object({
    accountId: z.uuid(),
    description: z
      .string()
      .trim()
      .max(255)
      .transform((v) => v || null)
      .nullable()
      .optional()
      .default(null),
    debit: amount.default(0),
    credit: amount.default(0),
    /** Charge this tax group on the line; the system adds a line for each tax component */
    taxGroupId: z.uuid().nullable().optional().default(null),
    /** The amount already includes the tax (otherwise the tax is added on top) */
    taxInclusive: z.boolean().optional().default(false),
    /** A line on a foreign-currency account: its amount is in this currency, and the base amount is worked out */
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional()
      .default(null),
    foreignDebit: amount.default(0),
    foreignCredit: amount.default(0),
    /** 1 unit of the currency in the base currency; omitted = the rate on the entry's date */
    rate: rateSchema.nullable().optional().default(null),
  })
  .refine((l) => (l.currency ? (l.foreignDebit > 0) !== (l.foreignCredit > 0) : (l.debit > 0) !== (l.credit > 0)), { message: 'Each line is either a debit or a credit.', path: ['debit'] })
  .refine((l) => !l.currency || !l.taxGroupId, { message: 'Tax goes on the base-currency line (e.g. the sale), not the foreign one.', path: ['taxGroupId'] })
  .refine((l) => l.taxGroupId !== null || !l.taxInclusive, { message: 'Choose a tax group for a tax-inclusive amount.', path: ['taxInclusive'] });
export type JournalLineInput = z.input<typeof journalLineSchema>;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

/** A draft may be unbalanced while it's being written; posting checks the balance. */
export const journalDraftSchema = z.object({
  date: isoDaySchema,
  memo: text(500),
  reference: text(64),
  lines: z.array(journalLineSchema).max(MAX_JOURNAL_LINES, `At most ${MAX_JOURNAL_LINES} lines.`).default([]),
});
export type JournalDraftInput = z.input<typeof journalDraftSchema>;

export const journalReverseSchema = z.object({
  /** Defaults to the original entry's date */
  date: isoDaySchema.optional(),
  memo: text(500),
});

export interface Totals {
  debit: number;
  credit: number;
  /** debit − credit; zero when balanced */
  difference: number;
}

export function totals(lines: readonly { debit: number; credit: number }[]): Totals {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debit;
    credit += l.credit;
  }
  return { debit, credit, difference: debit - credit };
}

/** Why an entry can't be posted yet, if anything (the API and the editor use the same rules). */
export function postingProblem(lines: readonly { debit: number; credit: number }[]): 'too_few_lines' | 'unbalanced' | 'zero' | null {
  if (lines.length < 2) return 'too_few_lines';
  const t = totals(lines);
  if (t.debit === 0) return 'zero';
  if (t.difference !== 0) return 'unbalanced';
  return null;
}

/** "1,234.5" → 123450 for a 2-decimal currency. Null when the text isn't an amount. */
export function toMinor(text: string, digits = 2): number | null {
  const clean = text.replace(/[\s,_']/g, '');
  if (!clean) return 0;
  if (!new RegExp(`^\\d+(\\.\\d{0,${digits}})?$`).test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  const minor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minor) && minor <= MAX_LINE_AMOUNT ? minor : null;
}

/** "JV/2026-27/0007" from the financial year's name and the entry number. */
export const journalNumber = (fiscalYearName: string, n: number) => `JV/${fiscalYearName.replace(/^FY\s*/, '').replace('–', '-')}/${String(n).padStart(4, '0')}`;

/** Supporting documents: PDF or images, up to 2 MB, checked by their bytes like logos. */
export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  type: z.enum(ATTACHMENT_TYPES, 'Attach a PDF, PNG, JPEG or WebP file.'),
  data: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The file could not be read.')
    .max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4, 'Attach a file under 2 MB.'),
});

/** The real type of a document from its first bytes. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'; // %PDF
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
