import { describe, expect, it } from 'vitest';
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
