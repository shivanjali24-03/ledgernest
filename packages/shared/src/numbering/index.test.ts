import { describe, expect, it } from 'vitest';
import { invoiceNumber } from '../invoices/index.js';
import { DEFAULT_SERIES, documentsIssued, numberSeriesUpdateSchema, formatDocNumber, nextSerial, numberSeriesSchema, renderAffix, seriesPreview, seriesProblems } from './index.js';

describe('Number series', () => {
  it('writes the financial year in four ways', () => {
    expect(renderAffix('A{FY}B{FY2}C{YYYY}D{YY}', 'FY 2026–27')).toBe('A2026-27B26-27C2026D26');
    // A calendar financial year
    expect(renderAffix('{FY}/{FY2}/{YY}', 'FY 2026')).toBe('2026/26/26');
  });

  it('gives the numbers LedgerNest always gave by default', () => {
    for (const n of [1, 42, 9999]) expect(formatDocNumber(DEFAULT_SERIES.invoice, 'FY 2026–27', n)).toBe(invoiceNumber('FY 2026–27', n));
    expect(formatDocNumber(DEFAULT_SERIES.credit_note, 'FY 2026–27', 3)).toBe(invoiceNumber('FY 2026–27', 3, 'CN'));
  });

  it('puts a prefix and suffix around a padded serial', () => {
    expect(formatDocNumber({ prefix: 'PNQ-', suffix: '/{FY2}', digits: 3 }, 'FY 2026–27', 7)).toBe('PNQ-007/26-27');
    expect(seriesPreview({ prefix: 'EXP', suffix: '', digits: 5, startNumber: 101 }, 'FY 2026–27')).toBe('EXP00101');
  });

  it('refuses series whose numbers GST wouldn’t accept', () => {
    expect(seriesProblems({ prefix: 'INV/{FY}/', suffix: '', digits: 4, startNumber: 1 }, 'FY 2026–27')).toEqual([]);
    expect(seriesProblems({ prefix: 'INVOICE/{FY}/', suffix: '', digits: 4, startNumber: 1 }, 'FY 2026–27')).toEqual(['too_long']);
    expect(seriesProblems({ prefix: 'A', suffix: '', digits: 2, startNumber: 500 }, 'FY 2026–27')).toEqual(['no_room']);
    expect(numberSeriesSchema.safeParse({ type: 'invoice', name: 'X', prefix: 'INV#' }).success).toBe(false);
    expect(numberSeriesSchema.safeParse({ type: 'invoice', name: 'X', prefix: 'INV {FY}' }).success).toBe(false);
    expect(numberSeriesSchema.parse({ type: 'invoice', name: 'Export', prefix: 'EXP/{FY2}/' })).toMatchObject({ digits: 4, startNumber: 1, resetYearly: true, suffix: '' });
    // A change touches only what's given
    expect(numberSeriesUpdateSchema.parse({ prefix: 'NL-' })).toEqual({ prefix: 'NL-' });
  });

  it('continues from the highest number, never below the start', () => {
    expect(nextSerial(null, 1)).toBe(1);
    expect(nextSerial(41, 1)).toBe(42);
    expect(nextSerial(null, 501)).toBe(501);
    expect(nextSerial(600, 501)).toBe(601);
  });

  it('summarises the documents issued per series for GSTR-1 Table 13', () => {
    expect(
      documentsIssued([
        { type: 'credit_note', series: 'Credit notes', serial: 1, number: 'CN/2026-27/0001', cancelled: false },
        { type: 'invoice', series: 'Tax invoices', serial: 2, number: 'INV/2026-27/0002', cancelled: true },
        { type: 'invoice', series: 'Tax invoices', serial: 1, number: 'INV/2026-27/0001', cancelled: false },
        { type: 'invoice', series: 'Exports', serial: 7, number: 'EXP-007', cancelled: false },
      ]),
    ).toEqual([
      { type: 'invoice', series: 'Exports', from: 'EXP-007', to: 'EXP-007', total: 1, cancelled: 0 },
      { type: 'invoice', series: 'Tax invoices', from: 'INV/2026-27/0001', to: 'INV/2026-27/0002', total: 2, cancelled: 1 },
      { type: 'credit_note', series: 'Credit notes', from: 'CN/2026-27/0001', to: 'CN/2026-27/0001', total: 1, cancelled: 0 },
    ]);
  });
});
