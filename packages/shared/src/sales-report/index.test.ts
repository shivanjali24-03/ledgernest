import { describe, expect, it } from 'vitest';
import { buildSalesReport, salesReportRows, type SalesReportLine } from './index.js';

const kumar = { id: 'c1', name: 'Kumar' };
const bluewave = { id: 'c2', name: 'Bluewave' };
const dev = { id: 'i1', name: 'Development' };
const line = (over: Partial<SalesReportLine>): SalesReportLine => ({ documentId: 'd1', contact: kumar, item: dev, quantity: '1', net: 1000, tax: 180, sign: 1, ...over });

describe('buildSalesReport', () => {
  const lines = [
    line({ documentId: 'inv1', quantity: '10', net: 10_000, tax: 1_800 }),
    line({ documentId: 'inv1', item: null, quantity: '1', net: 500, tax: 0 }),
    line({ documentId: 'inv2', contact: bluewave, quantity: '4', net: 4_000, tax: 720 }),
    line({ documentId: 'cn1', quantity: '2', net: 2_000, tax: 360, sign: -1 }),
  ];
  it('groups by customer, counting invoices and taking credit notes off', () => {
    const r = buildSalesReport(lines, 'contact');
    expect(r.rows.map((x) => [x.name, x.documents, x.net, x.tax, x.total, x.quantity])).toEqual([
      ['Kumar', 1, 8_500, 1_440, 9_940, null],
      ['Bluewave', 1, 4_000, 720, 4_720, null],
    ]);
    expect(r.totals).toEqual({ net: 12_500, tax: 2_160, total: 14_660 });
  });
  it('groups by item with quantities, lines without an item last', () => {
    const r = buildSalesReport(lines, 'item');
    expect(r.rows.map((x) => [x.name, x.documents, x.quantity, x.total])).toEqual([
      ['Development', 2, '12', 14_160],
      [null, 1, null, 500],
    ]);
    expect(salesReportRows({ side: 'sales', by: 'item', ...r }, 2).at(-1)).toEqual(['Total', '', '', '125.00', '21.60', '146.60']);
  });
});
