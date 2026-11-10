import { describe, expect, it } from 'vitest';
import { qrMatrix } from '../upi/index.js';
import { pdfTableBytes } from './index.js';

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('pdfTableBytes', () => {
  it('writes a well-formed PDF whose cross-reference table points at each object', () => {
    const pdf = text(pdfTableBytes({ title: 'Trial balance', subtitle: 'Acme · as of 2026-10-31', footer: 'LedgerNest', rows: [['Code', 'Account', 'Debit'], ['1000', 'Cash (main)', '1250.00']] }));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(pdf).toContain('(Cash \\(main\\)) Tj');
    expect(pdf).toContain('(Page 1 of 1) Tj');
    // stream lengths match
    for (const m of pdf.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 9)).toBe('endstream');
    }
  });

  it('pages long tables, repeating the header', () => {
    const rows = [['Account', 'Amount'], ...Array.from({ length: 150 }, (_, i) => [`Account ${i}`, String(i)])];
    const pdf = text(pdfTableBytes({ title: 'Long', rows }));
    expect(pdf).toContain('/Count 3');
    expect(pdf.match(/\(Account\) Tj/g)).toHaveLength(3);
    expect(pdf).toContain('(Page 3 of 3) Tj');
  });

  it('uses Windows-1252 and replaces what the standard fonts can’t show', () => {
    const pdf = text(pdfTableBytes({ title: 'Café – ₹ नमस्ते', rows: [['a']] }));
    expect(pdf).toContain('(Caf\xe9 \x96 Rs ??????) Tj');
  });

  it('turns landscape when the columns need it', () => {
    const wide = [Array.from({ length: 12 }, (_, i) => `Column heading ${i}`)];
    expect(text(pdfTableBytes({ title: 'Wide', rows: wide }))).toContain('/MediaBox [0 0 842 595]');
    expect(text(pdfTableBytes({ title: 'Narrow', rows: [['a', 'b']] }))).toContain('/MediaBox [0 0 595 842]');
  });
});

describe('pdfTableBytes info lines', () => {
  it('writes the extra header lines and still pages correctly', () => {
    const rows = [['A', 'B'], ...Array.from({ length: 60 }, (_, i) => [`r${i}`, String(i)])];
    const pdf = text(pdfTableBytes({ title: 'Tax invoice', subtitle: 'Seller', info: ['Bill to: Kumar Logistics', 'GSTIN 27AAKCK4821R1Z5'], rows }));
    expect(pdf).toContain('(Bill to: Kumar Logistics) Tj');
    expect(pdf).toContain('(GSTIN 27AAKCK4821R1Z5) Tj');
    expect(pdf).toContain('(Page 2 of 2) Tj');
  });
});

describe('pdfTableBytes after-text', () => {
  it('prints terms after the table, wrapping long lines', () => {
    const long = 'Bank: HDFC Bank, Baner branch. Account 50200012345678, IFSC HDFC0001234. Please quote the invoice number with your payment so we can match it quickly.';
    const pdf = text(pdfTableBytes({ title: 'Tax invoice', rows: [['A', 'B'], ['x', '1']], after: ['Terms', long] }));
    expect(pdf).toContain('(Terms) Tj');
    expect(pdf).toContain('(Bank: HDFC Bank,');
    expect(pdf).toContain('/Count 1');
  });
  it('moves them to a page of their own when the last page is full', () => {
    const rows = [['A', 'B'], ...Array.from({ length: 52 }, (_, i) => [`r${i}`, String(i)])];
    const pdf = text(pdfTableBytes({ title: 'Long', rows, after: Array.from({ length: 10 }, (_, i) => `Line ${i}`) }));
    expect(pdf).toContain('(Page 2 of 2) Tj');
    expect(pdf).toContain('(Line 9) Tj');
  });

  it('draws a QR code top right, with its caption, and starts the table below it', () => {
    const modules = qrMatrix('upi://pay?pa=shop%40ybl&pn=Shop&am=100.00&cu=INR');
    const dark = modules.flat().filter(Boolean).length;
    const pdf = text(pdfTableBytes({ title: 'Invoice INV-0001', rows: [['Item', 'Amount'], ['Tea', '100.00']], qr: { modules, caption: ['Scan to pay with any UPI app', 'Rs 100.00 to shop@ybl'] } }));
    expect(pdf.match(/ re\n/g)).toHaveLength(dark);
    expect(pdf).toContain('(Scan to pay with any UPI app) Tj');
    expect(pdf).toContain('(Rs 100.00 to shop@ybl) Tj');
    // Every square sits inside the top-right 88pt box
    for (const m of pdf.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) [\d.]+ re$/gm)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(595 - 40 - 88);
      expect(Number(m[1]) + Number(m[3])).toBeLessThanOrEqual(595 - 40 + 0.01);
      expect(Number(m[2])).toBeGreaterThanOrEqual(842 - 40 - 88);
    }
    // The table's header row is below the QR code and its caption
    const headerY = Number(/BT \/F2 8 Tf [\d.]+ ([\d.]+) Td \(Item\) Tj/.exec(pdf)![1]);
    expect(headerY).toBeLessThan(842 - 40 - 88 - 18);
  });
});

describe('Logos in PDFs', () => {
  // Just enough of a JPEG for its frame header: 64 x 32, three colours
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

  it('reads a JPEG’s size and colours, and refuses what isn’t one', async () => {
    const { jpegImage } = await import('./index.js');
    expect(jpegImage(jpeg)).toMatchObject({ width: 64, height: 32, filter: 'DCTDecode', colorSpace: 'DeviceRGB' });
    expect(jpegImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('places the logo at the top left of the first page and embeds it once', async () => {
    const { jpegImage, pdfTableBytes } = await import('./index.js');
    const text = String.fromCharCode(...pdfTableBytes({ title: 'Tax invoice INV/2026-27/0001', rows: [['Item', 'Amount'], ['Freight', '100.00']], logo: jpegImage(jpeg) }));
    expect(text).toContain('/XObject << /Im1 7 0 R >>');
    // 64 x 32 fits 120 x 40 as 80 x 40
    expect(text).toContain('q 80 0 0 40 40 762 cm /Im1 Do Q');
    expect(text).toContain('/Subtype /Image /Width 64 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    // The heading moves under it
    expect(text).toMatch(/BT \/F2 14 Tf 40 738 Td \(Tax invoice INV\/2026-27\/0001\) Tj ET/);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
