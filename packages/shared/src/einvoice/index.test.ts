import { describe, expect, it } from 'vitest';
import { buildEinvoice, einvoiceProblems, uqcOf, type EinvoiceInput } from './index.js';

const input = (over: Partial<EinvoiceInput> = {}): EinvoiceInput => ({
  kind: 'invoice',
  number: 'INV/2026-27/0042',
  date: '2026-10-05',
  currency: 'INR',
  placeOfSupply: '27',
  seller: { gstin: '27AAPFN1234C1Z5', legalName: 'Nest Demo Private Limited', tradeName: 'Nest Demo', address1: '4th Floor, Riverside Business Bay', address2: 'Baner Road', city: 'Pune', pin: '411045', phone: '+91 20 4000 1234', email: 'accounts@nestdemo.in' },
  buyer: { gstin: '27AAKCK4821R1Z4', legalName: 'Kumar Logistics Private Limited', address1: 'Plot 18, Hinjewadi Phase 2', city: 'Pune', pin: '411 057' },
  lines: [
    // 40 hours at ₹2,500 less 10%: ₹90,000, CGST + SGST 9% each
    { description: 'Software development, sprint 14', hsn: '998314', quantity: '40', unit: 'hrs', unitPrice: 2_500_00, amount: 90_000_00, heads: { igst: 0, cgst: 8_100_00, sgst: 8_100_00, cess: 0 }, gstRate: 18 },
    { description: 'Dell Latitude 5440', hsn: '84713010', quantity: '2', unit: 'Nos', unitPrice: 72_000_00, amount: 1_44_000_00, heads: { igst: 0, cgst: 12_960_00, sgst: 12_960_00, cess: 0 }, gstRate: 18 },
  ],
  ...over,
});

describe('GST e-invoice JSON', () => {
  it('builds the portal’s schema 1.1, amounts in rupees and dates as dd/mm/yyyy', () => {
    const e = buildEinvoice(input());
    expect(e).toMatchObject({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
      DocDtls: { Typ: 'INV', No: 'INV/2026-27/0042', Dt: '05/10/2026' },
      SellerDtls: { Gstin: '27AAPFN1234C1Z5', LglNm: 'Nest Demo Private Limited', TrdNm: 'Nest Demo', Addr1: '4th Floor, Riverside Business Bay', Addr2: 'Baner Road', Loc: 'Pune', Pin: 411045, Stcd: '27', Ph: '912040001234', Em: 'accounts@nestdemo.in' },
      BuyerDtls: { Gstin: '27AAKCK4821R1Z4', Pin: 411057, Stcd: '27', Pos: '27' },
    });
    expect(e.BuyerDtls).not.toHaveProperty('Addr2');
    expect(e.ItemList[0]).toEqual({ SlNo: '1', PrdDesc: 'Software development, sprint 14', IsServc: 'Y', HsnCd: '998314', Qty: 40, Unit: 'OTH', UnitPrice: 2500, TotAmt: 100000, Discount: 10000, AssAmt: 90000, GstRt: 18, IgstAmt: 0, CgstAmt: 8100, SgstAmt: 8100, CesAmt: 0, TotItemVal: 106200 });
    expect(e.ItemList[1]).toMatchObject({ IsServc: 'N', Unit: 'NOS', Qty: 2, Discount: 0, AssAmt: 144000, TotItemVal: 169920 });
    expect(e.ValDtls).toEqual({ AssVal: 234000, CgstVal: 21060, SgstVal: 21060, IgstVal: 0, CesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0, TotInvVal: 276120 });
    expect(buildEinvoice(input({ kind: 'credit_note' })).DocDtls.Typ).toBe('CRN');
  });

  it('finds everything the portal would refuse before building', () => {
    expect(einvoiceProblems(input())).toEqual([]);
    const bad = input({
      currency: 'USD',
      number: 'INVOICE/2026-27/00042',
      placeOfSupply: null,
      seller: { gstin: null, legalName: 'X', address1: null, city: 'Pu', pin: '41104' },
      buyer: { gstin: 'not a gstin', legalName: 'Y', address1: 'Road', city: 'Pune', pin: '011045' },
      lines: [{ ...input().lines[0]!, hsn: null }, { ...input().lines[1]!, hsn: '99' }],
    });
    expect(einvoiceProblems(bad)).toEqual([
      { code: 'not_inr' },
      { code: 'number_too_long' },
      { code: 'no_place_of_supply' },
      { code: 'gstin', party: 'seller' },
      { code: 'address', party: 'seller' },
      { code: 'city', party: 'seller' },
      { code: 'pin', party: 'seller' },
      { code: 'gstin', party: 'buyer' },
      { code: 'pin', party: 'buyer' },
      { code: 'hsn', line: 1 },
      { code: 'hsn', line: 2 },
    ]);
    expect(einvoiceProblems(input({ lines: [] }))).toEqual([{ code: 'no_lines' }]);
  });

  it('maps the units people type to the portal’s codes', () => {
    expect(['pcs', 'Kg', 'litre', 'box', 'Dozen', 'nos.'].map(uqcOf)).toEqual(['PCS', 'KGS', 'LTR', 'BOX', 'DOZ', 'NOS']);
    expect([null, 'hours', 'sprint'].map(uqcOf)).toEqual(['OTH', 'OTH', 'OTH']);
  });
});

describe('IRN from the portal', () => {
  const IRN = 'a'.repeat(32) + 'B1c2'.repeat(8);
  const QR = 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiLi4uIn0.c2lnbmF0dXJl';

  it('reads the IRN, acknowledgement and signed QR from the portal’s response, however it’s wrapped', async () => {
    const { irnFromPortal } = await import('./index.js');
    const flat = { AckNo: 112010036563310, AckDt: '2026-10-06 11:05:00', Irn: IRN, SignedQRCode: QR, Status: 'ACT' };
    expect(irnFromPortal(flat)).toEqual({ irn: IRN, ackNo: '112010036563310', ackDate: '2026-10-06 11:05:00', signedQrCode: QR });
    expect(irnFromPortal({ Status: 1, Data: flat })).toEqual(irnFromPortal(flat));
    expect(irnFromPortal([flat])).toEqual(irnFromPortal(flat));
    expect(irnFromPortal({ Status: 0, ErrorDetails: [] })).toBeNull();
    expect(irnFromPortal('nope')).toBeNull();
  });

  it('checks what’s typed in', async () => {
    const { einvoiceIrnSchema } = await import('./index.js');
    expect(einvoiceIrnSchema.parse({ irn: IRN, ackNo: '112010036563310', ackDate: '2026-10-06 11:05:00', signedQrCode: QR }).irn).toBe(IRN.toLowerCase());
    expect(einvoiceIrnSchema.safeParse({ irn: 'short', ackNo: '1', ackDate: 'x', signedQrCode: 'y' }).success).toBe(false);
  });
});

describe('E-invoices for exports and SEZ supplies', () => {
  it('marks the supply type, takes a buyer abroad as URP, and adds the shipping bill', async () => {
    const { buildEinvoice, einvoiceProblems } = await import('./index.js');
    const base = {
      kind: 'invoice' as const,
      number: 'EXP/26-27/1',
      date: '2026-10-05',
      currency: 'INR',
      placeOfSupply: null,
      seller: { gstin: '27AAPFN1234C1Z5', legalName: 'Nest Demo Private Limited', address1: 'Baner Road', city: 'Pune', pin: '411045' },
      buyer: { gstin: null, legalName: 'Northwind Inc.', address1: '500 Congress Ave', city: 'Austin', pin: null },
      lines: [{ description: 'Software', hsn: '998314', quantity: '1', unit: null, unitPrice: 1_00_000_00, amount: 1_00_000_00, heads: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, gstRate: 0 }],
    };
    const exp = { ...base, supplyKind: 'export_lut', exportDetails: { portCode: 'INBOM4', shippingBillNo: '7712345', shippingBillDate: '2026-10-06', countryCode: 'US' }, foreignCurrency: 'USD' };
    expect(einvoiceProblems(exp)).toEqual([]);
    const j = buildEinvoice(exp);
    expect(j.TranDtls.SupTyp).toBe('EXPWOP');
    expect(j.BuyerDtls).toMatchObject({ Gstin: 'URP', Pin: 999999, Stcd: '96', Pos: '96' });
    expect(j.ExpDtls).toEqual({ ShipBNo: '7712345', ShipBDt: '06/10/2026', Port: 'INBOM4', CntCode: 'US', ForCur: 'USD' });
    // A domestic buyer still needs a GSTIN
    expect(einvoiceProblems(base)).toContainEqual({ code: 'gstin', party: 'buyer' });
  });

  it('marks a reverse-charge supply, the buyer paying the tax', () => {
    expect(buildEinvoice(input({ reverseCharge: true })).TranDtls.RegRev).toBe('Y');
  });
});
