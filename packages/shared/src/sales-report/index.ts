import { z } from 'zod';
import { formatQuantity, parseQuantity } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Sales and purchases over some days, by customer (or vendor) or by item: how many documents, how much (for items),
 * net, tax and total, all in the base currency. Sales are issued invoices less issued credit notes; purchases are
 * recorded bills. Voided documents are left out.
 */
export const SALES_REPORT_SIDES = ['sales', 'purchases'] as const;
export type SalesReportSide = (typeof SALES_REPORT_SIDES)[number];
export const SALES_REPORT_BY = ['contact', 'item'] as const;
export type SalesReportBy = (typeof SALES_REPORT_BY)[number];

export const salesReportQuerySchema = z
  .object({ side: z.enum(SALES_REPORT_SIDES), by: z.enum(SALES_REPORT_BY).default('contact'), from: isoDaySchema, to: isoDaySchema })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });

/** One line of an invoice, credit note or bill, already in the base currency; credit notes have sign −1 */
export interface SalesReportLine {
  documentId: string;
  contact: { id: string; name: string };
  item: { id: string; name: string } | null;
  quantity: string;
  net: number;
  tax: number;
  sign: 1 | -1;
}

export interface SalesReportRow {
  /** The contact's or item's id; null for lines without an item */
  id: string | null;
  name: string | null;
  documents: number;
  /** Only by item */
  quantity: string | null;
  net: number;
  tax: number;
  total: number;
}

/** Groups the lines by contact or item, biggest total first (lines without an item last) */
export function buildSalesReport(lines: SalesReportLine[], by: SalesReportBy) {
  const groups = new Map<string, { row: SalesReportRow; docs: Set<string>; qty: bigint }>();
  for (const l of lines) {
    const key = by === 'contact' ? l.contact.id : (l.item?.id ?? '');
    let g = groups.get(key);
    if (!g) {
      const ref = by === 'contact' ? l.contact : l.item;
      g = { row: { id: ref?.id ?? null, name: ref?.name ?? null, documents: 0, quantity: null, net: 0, tax: 0, total: 0 }, docs: new Set(), qty: 0n };
      groups.set(key, g);
    }
    if (l.sign > 0) g.docs.add(l.documentId);
    g.qty += BigInt(l.sign) * (parseQuantity(l.quantity) ?? 0n);
    g.row.net += l.sign * l.net;
    g.row.tax += l.sign * l.tax;
  }
  const rows = [...groups.values()].map(({ row, docs, qty }) => ({
    ...row,
    documents: docs.size,
    quantity: by === 'item' && row.id ? (qty < 0n ? `-${formatQuantity(-qty)}` : formatQuantity(qty)) : null,
    total: row.net + row.tax,
  }));
  rows.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.total - a.total || (a.name ?? '').localeCompare(b.name ?? '')));
  const totals = rows.reduce((s, r) => ({ net: s.net + r.net, tax: s.tax + r.tax, total: s.total + r.total }), { net: 0, tax: 0, total: 0 });
  return { rows, totals };
}

/** The report as CSV rows (amounts in major units) */
export function salesReportRows(r: { side: SalesReportSide; by: SalesReportBy; rows: SalesReportRow[]; totals: { net: number; tax: number; total: number } }, digits: number, noItem = 'No item'): string[][] {
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  const who = r.by === 'item' ? 'Item' : r.side === 'sales' ? 'Customer' : 'Vendor';
  return [
    [who, 'Documents', ...(r.by === 'item' ? ['Quantity'] : []), 'Net', 'Tax', 'Total'],
    ...r.rows.map((x) => [x.name ?? noItem, String(x.documents), ...(r.by === 'item' ? [x.quantity ?? ''] : []), fmt(x.net), fmt(x.tax), fmt(x.total)]),
    ['Total', '', ...(r.by === 'item' ? [''] : []), fmt(r.totals.net), fmt(r.totals.tax), fmt(r.totals.total)],
  ];
}
