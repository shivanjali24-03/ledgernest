import { z } from 'zod';

/**
 * Number series: how a document's number is written. GST (rule 46(b)) wants a consecutive serial number, unique for
 * the financial year, of at most 16 characters using letters, digits, "-" and "/". A series is a prefix and a suffix
 * around the serial, which can carry the financial year ({FY} → 2026-27, {FY2} → 26-27, {YYYY} → 2026, {YY} → 26).
 * Several series per document type let a business keep, say, separate export or branch invoices. The number is
 * written onto the document when it's issued, so changing a series never changes a number already given.
 */

export const NUMBERED_DOCUMENTS = ['invoice', 'credit_note', 'debit_note'] as const;
export type NumberedDocument = (typeof NUMBERED_DOCUMENTS)[number];

/** The longest document number GST allows */
export const DOC_NUMBER_MAX = 16;
const ALLOWED = /^[A-Za-z0-9/-]*$/;
const TOKEN = /\{(FY|FY2|YYYY|YY)\}/g;

/** The series each organisation starts with: the numbers LedgerNest has always given */
export const DEFAULT_SERIES: Record<NumberedDocument, { name: string; prefix: string; suffix: string; digits: number }> = {
  invoice: { name: 'Tax invoices', prefix: 'INV/{FY}/', suffix: '', digits: 4 },
  credit_note: { name: 'Credit notes', prefix: 'CN/{FY}/', suffix: '', digits: 4 },
  debit_note: { name: 'Debit notes', prefix: 'DN/{FY}/', suffix: '', digits: 4 },
};

/** The financial year as numbers use it: "FY 2026–27" → 2026-27 */
const fy = (fiscalYearName: string) => fiscalYearName.replace(/^FY\s*/, '').replace('–', '-');

/** A prefix or suffix with the year written in */
export function renderAffix(text: string, fiscalYearName: string) {
  const full = fy(fiscalYearName);
  const start = full.match(/\d{4}/)?.[0] ?? full;
  const two = full.match(/^(\d{2})(\d{2})-(\d{2})$/);
  const short = two ? `${two[2]}-${two[3]}` : start.slice(-2);
  return text.replace(TOKEN, (_, t: string) => (t === 'FY' ? full : t === 'FY2' ? short : t === 'YYYY' ? start : start.slice(-2)));
}

export interface SeriesFormat {
  prefix: string;
  suffix: string;
  digits: number;
}

/** A document's number in its series */
export const formatDocNumber = (s: SeriesFormat, fiscalYearName: string, n: number) => `${renderAffix(s.prefix, fiscalYearName)}${String(n).padStart(s.digits, '0')}${renderAffix(s.suffix, fiscalYearName)}`;

const affixText = z
  .string()
  .trim()
  .max(24)
  .refine((v) => ALLOWED.test(v.replace(TOKEN, '')), 'Use letters, digits, "-" and "/" (and {FY}, {FY2}, {YYYY} or {YY} for the year).');
const affix = affixText.default('');
const seriesName = z.string().trim().min(1, 'Name the series.').max(40);
const digits = z.number().int().min(1).max(8);
const startNumber = z.number().int().min(1).max(99_999_999);

export const numberSeriesSchema = z.object({
  type: z.enum(NUMBERED_DOCUMENTS),
  name: seriesName,
  prefix: affix,
  suffix: affix,
  digits: digits.default(4),
  startNumber: startNumber.default(1),
  /** Start again from the first number each financial year */
  resetYearly: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type NumberSeriesInput = z.input<typeof numberSeriesSchema>;
export type NumberSeriesValues = z.output<typeof numberSeriesSchema>;
/** A change to a series: only what's given changes */
export const numberSeriesUpdateSchema = z.object({
  name: seriesName.optional(),
  prefix: affixText.optional(),
  suffix: affixText.optional(),
  digits: digits.optional(),
  startNumber: startNumber.optional(),
  resetYearly: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type NumberSeriesUpdate = z.input<typeof numberSeriesUpdateSchema>;

/**
 * What would make a series give numbers GST refuses, checked with the longest number it would give this year: the
 * year written in and the serial at its widest (its digits, or the start number if wider).
 */
export function seriesProblems(s: SeriesFormat & { startNumber: number }, fiscalYearName: string): ('too_long' | 'no_room')[] {
  const widest = Math.max(10 ** s.digits - 1, s.startNumber);
  const longest = formatDocNumber(s, fiscalYearName, widest);
  const out: ('too_long' | 'no_room')[] = [];
  if (longest.length > DOC_NUMBER_MAX) out.push('too_long');
  // A serial that already needs more digits than the series pads to still works, but leaves no room to grow
  if (String(s.startNumber).length > s.digits) out.push('no_room');
  return out;
}

/** The series' first number, as a preview */
export const seriesPreview = (s: SeriesFormat & { startNumber: number }, fiscalYearName: string) => formatDocNumber(s, fiscalYearName, s.startNumber);

/** The next serial in a series: one after the highest given (this year, if it starts again each year), never below the start */
export const nextSerial = (highest: number | null | undefined, startNumber: number) => Math.max((highest ?? 0) + 1, startNumber);

export interface NumberSeries extends NumberSeriesValues {
  id: string;
  archived: boolean;
  /** The first number it would give now */
  preview: string;
  /** How many documents it has numbered */
  used: number;
}

/**
 * GSTR-1 Table 13 (documents issued): for each series, the first and last number given in the period, how many,
 * and how many of those were cancelled.
 */
export interface DocumentIssueRow {
  type: NumberedDocument;
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
}
export function documentsIssued(docs: { type: NumberedDocument; series: string; serial: number; number: string; cancelled: boolean }[]): DocumentIssueRow[] {
  const groups = new Map<string, typeof docs>();
  for (const d of docs) {
    const k = `${d.type}\u0000${d.series}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const order = (t: NumberedDocument) => NUMBERED_DOCUMENTS.indexOf(t);
  return [...groups.values()]
    .map((g) => {
      const sorted = [...g].sort((a, b) => a.serial - b.serial);
      return { type: g[0]!.type, series: g[0]!.series, from: sorted[0]!.number, to: sorted[sorted.length - 1]!.number, total: g.length, cancelled: g.filter((d) => d.cancelled).length };
    })
    .sort((a, b) => order(a.type) - order(b.type) || a.series.localeCompare(b.series));
}
