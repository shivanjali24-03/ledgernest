import { csvCell, currencyDigits } from '@ledgernest/shared';

/** Rows as a CSV file (UTF-8 with a byte-order mark, cells guarded against formulas), as the API sends them */
export const csvBlob = (rows: unknown[][]) => new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });

/** An amount in its currency's major unit, e.g. 1180000 paise → "11800.00" */
export const major = (minor: number, currency: string) => (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
