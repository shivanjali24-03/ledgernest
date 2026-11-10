import { z } from 'zod';
import { zeroHeads, type GstHeads } from './index.js';

/**
 * GSTR-2B reconciliation: the purchase invoices your suppliers filed (GSTR-2B, downloaded as JSON from the GST
 * portal) against the bills in the books. Input tax credit is only safe when the supplier filed the invoice, so
 * this shows what's matched, what differs, bills the suppliers haven't filed (credit at risk) and filed invoices
 * missing from the books (credit not yet claimed).
 */

export type Gstr2bKind = 'invoice' | 'credit_note' | 'debit_note';

/** One document from GSTR-2B, amounts in paise */
export interface Gstr2bDoc {
  kind: Gstr2bKind;
  supplierGstin: string;
  supplierName: string | null;
  number: string;
  /** yyyy-mm-dd */
  date: string;
  taxable: number;
  heads: GstHeads;
  total: number;
  /** "itcavl": the portal says the credit can be taken */
  itcAvailable: boolean;
  reverseCharge: boolean;
}

export interface Gstr2bFile {
  /** The buyer's GSTIN the return is for */
  gstin: string | null;
  /** "102026" for October 2026, as the portal writes it */
  period: string | null;
  docs: Gstr2bDoc[];
}

export class Gstr2bError extends Error {
  constructor(readonly reason: 'not_json' | 'not_gstr2b' | 'too_many') {
    super(reason);
  }
}

/** Rupees with paise, as the portal writes them, into paise */
const paise = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
/** dd-mm-yyyy into yyyy-mm-dd */
const isoDate = (v: unknown) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

const item = z.looseObject({ txval: z.unknown(), igst: z.unknown(), cgst: z.unknown(), sgst: z.unknown(), cess: z.unknown() });
const doc = z.looseObject({ val: z.unknown(), dt: z.unknown(), rev: z.unknown(), itcavl: z.unknown(), items: z.array(item).optional() });
const number = z.union([z.string(), z.number()]);
const b2bSupplier = z.looseObject({ ctin: z.string(), trdnm: z.string().optional(), inv: z.array(doc.extend({ inum: number })) });
const cdnrSupplier = z.looseObject({ ctin: z.string(), trdnm: z.string().optional(), nt: z.array(doc.extend({ ntnum: number, typ: z.unknown() })) });
const file = z.looseObject({
  data: z.looseObject({
    gstin: z.string().optional(),
    rtnprd: z.string().optional(),
    docdata: z.looseObject({
      b2b: z.array(b2bSupplier).optional(),
      cdnr: z.array(cdnrSupplier).optional(),
    }),
  }),
});

const MAX_DOCS = 20_000;
export const GSTR2B_MAX_BYTES = 4 * 1024 * 1024;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.');

/** POST /reports/gst/gstr-2b: the portal's JSON, and the bill dates to match it against */
export const gstr2bRequestSchema = z
  .object({
    content: z.string().min(1, 'The file is empty.').max(GSTR2B_MAX_BYTES, 'GSTR-2B files can be up to 4 MB.'),
    from: day,
    to: day,
  })
  .refine((v) => v.from <= v.to, { message: 'The start comes after the end.', path: ['to'] });
export type Gstr2bRequest = z.infer<typeof gstr2bRequestSchema>;

/** Reads GSTR-2B JSON from the portal: B2B invoices, and credit and debit notes (CDNR) */
export function parseGstr2b(text: string): Gstr2bFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Gstr2bError('not_json');
  }
  const parsed = file.safeParse(raw);
  if (!parsed.success) throw new Gstr2bError('not_gstr2b');
  const { data } = parsed.data;
  const docs: Gstr2bDoc[] = [];
  const read = (s: { ctin: string; trdnm?: string }, d: z.infer<typeof doc>, kind: Gstr2bKind, no: string | number) => {
    const heads = zeroHeads();
    let taxable = 0;
    for (const it of d.items ?? []) {
      taxable += paise(it.txval);
      heads.igst += paise(it.igst);
      heads.cgst += paise(it.cgst);
      heads.sgst += paise(it.sgst);
      heads.cess += paise(it.cess);
    }
    docs.push({
      kind,
      supplierGstin: s.ctin.trim().toUpperCase(),
      supplierName: s.trdnm?.trim() || null,
      number: String(no).trim(),
      date: isoDate(d.dt),
      taxable,
      heads,
      total: paise(d.val),
      itcAvailable: String(d.itcavl ?? 'Y').toUpperCase() !== 'N',
      reverseCharge: String(d.rev ?? 'N').toUpperCase() === 'Y',
    });
  };
  for (const s of data.docdata.b2b ?? []) for (const d of s.inv) read(s, d, 'invoice', d.inum);
  for (const s of data.docdata.cdnr ?? []) for (const d of s.nt) read(s, d, String(d.typ ?? 'C').toUpperCase() === 'D' ? 'debit_note' : 'credit_note', d.ntnum);
  if (docs.length > MAX_DOCS) throw new Gstr2bError('too_many');
  return { gstin: data.gstin?.trim().toUpperCase() || null, period: data.rtnprd?.trim() || null, docs };
}

/**
 * Invoice numbers as suppliers and bookkeepers both write them: "INV/001/26-27", "inv-1/2627" and "INV 1 26 27" are
 * the same. Upper case, leading zeros dropped from each run of digits, then only letters and digits kept.
 */
export function docKey(number: string): string {
  return number
    .toUpperCase()
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ''))
    .replace(/[^A-Z0-9]/g, '');
}

/** A bill as the books have it, in the base currency (paise) */
export interface Gstr2bBill {
  id: string;
  /** Our own number, e.g. BILL/2026-27/0004 */
  number: string | null;
  /** The supplier's invoice number */
  vendorReference: string | null;
  vendorName: string;
  vendorGstin: string | null;
  date: string;
  taxable: number;
  heads: GstHeads;
  total: number;
}

export type Gstr2bStatus = 'matched' | 'mismatch' | 'probable' | 'missing_in_books' | 'missing_in_2b' | 'note';
export const GSTR2B_STATUSES: Gstr2bStatus[] = ['mismatch', 'missing_in_2b', 'missing_in_books', 'probable', 'matched', 'note'];

export interface Gstr2bRow {
  status: Gstr2bStatus;
  supplierGstin: string;
  supplierName: string | null;
  doc: Gstr2bDoc | null;
  bill: Gstr2bBill | null;
  /** 2B less books, for matched pairs */
  diff: { taxable: number; tax: number } | null;
  /** What differs, for mismatches and probable matches */
  problems: ('taxable' | 'tax' | 'tax_type' | 'date' | 'number')[];
}

export interface Gstr2bResult {
  rows: Gstr2bRow[];
  summary: Record<Gstr2bStatus, { count: number; tax: number }>;
  /** Bills left out: no supplier GSTIN, or no GST on them */
  skipped: number;
}

const taxOf = (h: GstHeads) => h.igst + h.cgst + h.sgst + h.cess;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Matches GSTR-2B invoices to bills: first by supplier GSTIN and invoice number (written loosely), then, for what's
 * left, by supplier, total and a date within a week (a probable match with the number typed differently). Amounts
 * within the tolerance (₹1 by default, for rounding) count as equal. Credit and debit notes are listed as they are.
 */
export function reconcileGstr2b(docs: Gstr2bDoc[], bills: Gstr2bBill[], tolerance = 100): Gstr2bResult {
  const rows: Gstr2bRow[] = [];
  const usable = bills.filter((b) => b.vendorGstin && taxOf(b.heads) !== 0);
  const skipped = bills.length - usable.length;
  const left = new Set(usable);
  const byKey = new Map<string, Gstr2bBill[]>();
  for (const b of usable) {
    if (!b.vendorReference) continue;
    const k = `${b.vendorGstin!.toUpperCase()}|${docKey(b.vendorReference)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }
  const compare = (d: Gstr2bDoc, b: Gstr2bBill) => {
    const diff = { taxable: d.taxable - b.taxable, tax: taxOf(d.heads) - taxOf(b.heads) };
    const problems: Gstr2bRow['problems'] = [];
    if (Math.abs(diff.taxable) > tolerance) problems.push('taxable');
    if (Math.abs(diff.tax) > tolerance) problems.push('tax');
    // IGST on one side and CGST + SGST on the other: the place of supply is wrong somewhere
    if ((d.heads.igst > 0) !== (b.heads.igst > 0) && taxOf(d.heads) > 0 && taxOf(b.heads) > 0) problems.push('tax_type');
    if (d.date && b.date !== d.date) problems.push('date');
    return { diff, problems };
  };

  const unmatched: Gstr2bDoc[] = [];
  for (const d of docs) {
    if (d.kind !== 'invoice') {
      rows.push({ status: 'note', supplierGstin: d.supplierGstin, supplierName: d.supplierName, doc: d, bill: null, diff: null, problems: [] });
      continue;
    }
    const b = (byKey.get(`${d.supplierGstin}|${docKey(d.number)}`) ?? []).find((x) => left.has(x));
    if (!b) {
      unmatched.push(d);
      continue;
    }
    left.delete(b);
    const { diff, problems } = compare(d, b);
    // A different date alone is worth seeing but doesn't stop the credit
    rows.push({ status: problems.some((p) => p !== 'date') ? 'mismatch' : 'matched', supplierGstin: d.supplierGstin, supplierName: d.supplierName ?? b.vendorName, doc: d, bill: b, diff, problems });
  }
  for (const d of unmatched) {
    const b = [...left].find((x) => x.vendorGstin!.toUpperCase() === d.supplierGstin && Math.abs(x.total - d.total) <= tolerance && (!d.date || daysApart(x.date, d.date) <= 7));
    if (b) {
      left.delete(b);
      const { diff, problems } = compare(d, b);
      rows.push({ status: 'probable', supplierGstin: d.supplierGstin, supplierName: d.supplierName ?? b.vendorName, doc: d, bill: b, diff, problems: ['number', ...problems.filter((p) => p !== 'date')] });
    } else rows.push({ status: 'missing_in_books', supplierGstin: d.supplierGstin, supplierName: d.supplierName, doc: d, bill: null, diff: null, problems: [] });
  }
  for (const b of left) rows.push({ status: 'missing_in_2b', supplierGstin: b.vendorGstin!.toUpperCase(), supplierName: b.vendorName, doc: null, bill: b, diff: null, problems: [] });

  const order = (r: Gstr2bRow) => GSTR2B_STATUSES.indexOf(r.status);
  rows.sort((a, b) => order(a) - order(b) || (a.supplierName ?? a.supplierGstin).localeCompare(b.supplierName ?? b.supplierGstin) || (a.doc?.date ?? a.bill?.date ?? '').localeCompare(b.doc?.date ?? b.bill?.date ?? ''));
  const summary = Object.fromEntries(GSTR2B_STATUSES.map((s) => [s, { count: 0, tax: 0 }])) as Gstr2bResult['summary'];
  for (const r of rows) {
    summary[r.status].count++;
    // The credit at stake: the books' tax for bills not filed, the portal's for the rest
    summary[r.status].tax += r.status === 'missing_in_2b' ? taxOf(r.bill!.heads) : taxOf(r.doc!.heads) * (r.doc!.kind === 'credit_note' ? -1 : 1);
  }
  return { rows, summary, skipped };
}

/** The result as rows for CSV or Excel: one line per pair, 2B beside the books */
export function gstr2bRows(r: Gstr2bResult, labels: Record<Gstr2bStatus, string> = { matched: 'Matched', mismatch: 'Amounts differ', probable: 'Probable match', missing_in_books: 'Not in the books', missing_in_2b: 'Not in GSTR-2B', note: 'Credit/debit note' }): (string | number)[][] {
  const rupees = (p: number | null | undefined) => (p == null ? '' : (p / 100).toFixed(2));
  return [
    ['Status', 'Supplier GSTIN', 'Supplier', '2B number', '2B date', '2B taxable value', '2B tax', 'Bill', 'Supplier number in books', 'Bill date', 'Books taxable value', 'Books tax', 'Taxable difference', 'Tax difference', 'What differs'],
    ...r.rows.map((x) => [
      labels[x.status],
      x.supplierGstin,
      x.supplierName ?? '',
      x.doc?.number ?? '',
      x.doc?.date ?? '',
      rupees(x.doc?.taxable),
      rupees(x.doc && taxOf(x.doc.heads)),
      x.bill?.number ?? '',
      x.bill?.vendorReference ?? '',
      x.bill?.date ?? '',
      rupees(x.bill?.taxable),
      rupees(x.bill && taxOf(x.bill.heads)),
      rupees(x.diff?.taxable),
      rupees(x.diff?.tax),
      x.problems.join(' '),
    ]),
  ];
}
