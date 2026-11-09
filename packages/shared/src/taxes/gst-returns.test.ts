import { describe, expect, it } from 'vitest';
import { gstSetOff } from './index.js';

describe('GST set-off', () => {
  it('uses IGST credit first on IGST, then CGST and SGST', () => {
    const r = gstSetOff({ igst: 1_000, cgst: 500, sgst: 500, cess: 0 }, { igst: 1_800, cgst: 0, sgst: 0, cess: 0 });
    expect(r.cash).toEqual({ igst: 0, cgst: 0, sgst: 200, cess: 0 });
    expect(r.carriedForward.igst).toBe(0);
    expect(r.used.igst).toEqual({ igst: 1_000, cgst: 500, sgst: 300, cess: 0 });
  });
  it('never sets CGST credit against SGST, and carries what is left forward', () => {
    const r = gstSetOff({ igst: 0, cgst: 100, sgst: 900, cess: 0 }, { igst: 0, cgst: 600, sgst: 100, cess: 0 });
    expect(r.cash).toEqual({ igst: 0, cgst: 0, sgst: 800, cess: 0 });
    expect(r.carriedForward).toEqual({ igst: 0, cgst: 500, sgst: 0, cess: 0 });
  });
  it('uses CGST and SGST credit on IGST once their own heads are paid', () => {
    const r = gstSetOff({ igst: 1_000, cgst: 100, sgst: 100, cess: 50 }, { igst: 0, cgst: 400, sgst: 400, cess: 10 });
    expect(r.cash).toEqual({ igst: 400, cgst: 0, sgst: 0, cess: 40 });
    expect(r.used.cgst.igst + r.used.sgst.igst).toBe(600);
  });
});
