import { describe, expect, it } from 'vitest';
import { chequeFigures, chequeLayout, chequeOptionsSchema, chequePdfBytes, chequeWords } from './index.js';

const text = (b: Uint8Array) => String.fromCharCode(...b);

describe('Cheque printing', () => {
  it('writes the figures in Indian groups, guarded at both ends', () => {
    expect(chequeFigures(1_18_000_00)).toBe('**1,18,000/-');
    expect(chequeFigures(12_34_56_789_50)).toBe('**12,34,56,789.50/-');
    expect(chequeFigures(950_00)).toBe('**950/-');
  });

  it('splits the words over two lines, without "Indian"', () => {
    expect(chequeWords(1_18_000_00)).toEqual(['One Lakh Eighteen Thousand Only', '']);
    const [a, b] = chequeWords(98_76_54_321_99);
    expect(a.length).toBeLessThanOrEqual(62);
    expect(`${a} ${b}`).toBe('Ninety Eight Crore Seventy Six Lakh Fifty Four Thousand Three Hundred and Twenty One and Ninety Nine Paise Only');
  });

  it('lays out the date boxes, payee, words and figures, nudged and crossed as asked', () => {
    const o = chequeOptionsSchema.parse({});
    expect(o).toEqual({ offsetX: 0, offsetY: 0, crossed: true });
    const l = chequeLayout({ payee: 'Sharma Office Supplies', date: '2026-10-05', amount: 53_100_00 }, o);
    expect(l.texts.map((t) => t.text)).toEqual(['05102026', 'SHARMA OFFICE SUPPLIES', 'Fifty Three Thousand One Hundred Only', '', '**53,100/-', 'A/c Payee']);
    expect(l.lines).toHaveLength(2);
    const moved = chequeLayout({ payee: 'X', date: '2026-10-05', amount: 1 }, chequeOptionsSchema.parse({ offsetX: '2.5', offsetY: '-1', crossed: 'false' }));
    expect(moved.texts[0]).toMatchObject({ x: 158, y: 10.5 });
    expect(moved.lines).toEqual([]);
    expect(moved.texts.some((t) => t.text === 'A/c Payee')).toBe(false);
    expect(chequeOptionsSchema.safeParse({ offsetX: 40 }).success).toBe(false);
  });

  it('makes a PDF the size of the leaf', () => {
    const pdf = text(chequePdfBytes({ payee: 'Sharma Office Supplies', date: '2026-10-05', amount: 53_100_00 }, chequeOptionsSchema.parse({})));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 576 261]');
    expect(pdf).toContain('(SHARMA OFFICE SUPPLIES) Tj');
    expect(pdf).toContain('(**53,100/-) Tj');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
