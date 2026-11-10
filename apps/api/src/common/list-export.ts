import { csvCell, currencyDigits } from '@ledgernest/shared';

/** The most rows a list download holds */
export const LIST_EXPORT_LIMIT = 10_000;

/** Every page of a list (100 at a time), up to the export limit */
export async function allPages<T>(
  fetch: (page: number) => Promise<{ total: number; items: T[] }>,
) {
  const out: T[] = [];
  for (let page = 1; out.length < LIST_EXPORT_LIMIT; page++) {
    const r = await fetch(page);
    out.push(...r.items);
    if (!r.items.length || out.length >= r.total) break;
  }
  return out.slice(0, LIST_EXPORT_LIMIT);
}

/** Rows as CSV with a byte-order mark (Excel opens it as UTF-8), cells guarded against formulas */
export const toCsv = (rows: unknown[][]) =>
  `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** An amount in its currency's major unit, e.g. 1180000 paise → "11800.00" */
export const major = (minor: number, currency: string) =>
  (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
