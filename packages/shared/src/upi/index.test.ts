import { describe, expect, it } from 'vitest';
import { isUpiId, qrMatrix, qrSvgPath, upiPayUri } from './index.js';

describe('UPI', () => {
  it('knows a UPI ID when it sees one', () => {
    for (const ok of ['sharmatraders@okhdfcbank', 'asha.k-92@ybl', '9876543210@paytm', 'shop_1@upi']) expect(isUpiId(ok), ok).toBe(true);
    for (const bad of ['', 'sharma', '@okaxis', 'a@b', 'sharma@ok axis', 'sharma@@ybl', 'sharma@1bank', 'shar ma@ybl']) expect(isUpiId(bad), bad).toBe(false);
  });

  it('builds the pay link with the amount in rupees, everything percent-encoded', () => {
    expect(upiPayUri({ upiId: 'sharmatraders@okhdfcbank', name: 'Sharma Traders', amount: 1_18_000_50, note: 'Invoice INV/2026/0042', reference: 'INV/2026/0042' })).toBe(
      'upi://pay?pa=sharmatraders%40okhdfcbank&pn=Sharma%20Traders&am=118000.50&cu=INR&tn=Invoice%20INV%2F2026%2F0042&tr=INV%2F2026%2F0042',
    );
  });

  it('leaves the amount for the payer to type when there is none, and stays ASCII for any script', () => {
    const uri = upiPayUri({ upiId: 'shop@ybl', name: 'शर्मा ट्रेडर्स', amount: null });
    expect(uri).toBe(`upi://pay?pa=shop%40ybl&pn=${encodeURIComponent('शर्मा ट्रेडर्स')}&cu=INR`);
    expect(/^[\x20-\x7e]+$/.test(uri)).toBe(true);
  });

  it('makes a square QR code with the three finder patterns in the corners', () => {
    const m = qrMatrix(upiPayUri({ upiId: 'sharmatraders@okhdfcbank', name: 'Sharma Traders', amount: 1_000_00, note: 'Invoice INV-0001' }));
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect((n - 17) % 4).toBe(0);
    expect(m.every((row) => row.length === n)).toBe(true);
    // A finder pattern: a dark 7x7 ring, a light ring inside it, and a dark 3x3 centre
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          expect(m[r0 + r]![c0 + c], `${r0 + r},${c0 + c}`).toBe(ring || centre);
        }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
  });

  it('draws the code as an SVG path with a quiet zone', () => {
    const m = qrMatrix('upi://pay?pa=a%40ybl&pn=A&cu=INR');
    const { d, size } = qrSvgPath(m);
    expect(size).toBe(m.length + 8);
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect(d.match(/M/g)).toHaveLength(m.flat().filter(Boolean).length);
  });
});
