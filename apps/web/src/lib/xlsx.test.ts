import { parseCsv } from '@ledgernest/shared';
import { csvToRows, xlsx } from './xlsx';

describe('xlsx', () => {
  it('writes a zip with the workbook, its sheet and the cells', async () => {
    const blob = xlsx([{ name: 'Profit & loss', rows: csvToRows('﻿"section","amount"\r\n"revenue","3000.00"\r\n"note","\'-x"\r\n', parseCsv) }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<sheet name="Profit &amp; loss"');
    expect(text).toContain('<c r="B2"><v>3000</v></c>');
    expect(text).toContain('<t xml:space="preserve">revenue</t>');
    expect(text).toContain('<t xml:space="preserve">-x</t>');
    // The end-of-directory record says how many files there are
    expect(new DataView(bytes.buffer).getUint16(bytes.length - 12, true)).toBe(6);
  });
  it('keeps codes as text', () => {
    expect(csvToRows('"code","amount"\r\n"1100.01","12.50"\r\n', parseCsv)).toEqual([
      ['code', 'amount'],
      ['1100.01', 12.5],
    ]);
  });
});
