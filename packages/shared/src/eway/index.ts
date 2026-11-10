import { z } from 'zod';
import { uqcOf, type EinvoiceInput, type EinvoiceLine } from '../einvoice/index.js';

/**
 * E-way bills: an invoice for goods as the JSON the e-way bill portal's bulk generation takes (version 1.0.0621), for
 * moving goods worth more than ₹50,000. Part A (who, what, where) always comes from the invoice; Part B (the vehicle
 * or transport document) can be filled now or later on the portal. Services (SAC codes starting 99) aren't moved, so
 * they're left out. As with e-invoices, everything the portal would refuse is reported first.
 */

/** Goods worth more than this (paise, tax included) need an e-way bill to move */
export const EWAY_THRESHOLD = 50_000_00;

export const EWAY_MODES = ['road', 'rail', 'air', 'ship'] as const;
export type EwayMode = (typeof EWAY_MODES)[number];
const MODE_CODE: Record<EwayMode, string> = { road: '1', rail: '2', air: '3', ship: '4' };

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const upper = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : v);

export const ewayTransportSchema = z.object({
  mode: z.enum(EWAY_MODES).default('road'),
  /** Approximate kilometres; 0 lets the portal work it out from the PIN codes */
  distanceKm: z.number().int().min(0).max(4000).default(0),
  vehicleNo: z.preprocess((v) => blank(upper(v)), z.string().regex(/^[A-Z]{2}[0-9A-Z]{4,13}$/, 'Not a vehicle number.').nullish()),
  /** The transporter's GSTIN or 15-character transporter ID */
  transporterId: z.preprocess((v) => blank(upper(v)), z.string().regex(/^[0-9A-Z]{15}$/, 'Not a GSTIN or transporter ID.').nullish()),
  transporterName: z.preprocess(blank, z.string().trim().max(100).nullish()),
  /** Railway receipt, airway bill or bill of lading number, for transport other than by road */
  docNo: z.preprocess(blank, z.string().trim().max(15).nullish()),
  docDate: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
});
export type EwayTransport = z.output<typeof ewayTransportSchema>;
export type EwayTransportInput = z.input<typeof ewayTransportSchema>;

export type EwayProblem =
  | { code: 'not_inr' | 'no_goods' | 'number_too_long' | 'no_place_of_supply' | 'transport_doc' }
  | { code: 'gstin' | 'address' | 'city' | 'pin'; party: 'seller' | 'buyer' }
  | { code: 'hsn'; line: number };

const GSTIN = /^\d{2}[A-Z0-9]{13}$/;
const PIN = /^[1-9]\d{5}$/;
const rupees = (paise: number) => Math.round(paise) / 100;
const ddmmyyyy = (d: string) => d.split('-').reverse().join('/');
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isService = (l: EinvoiceLine) => !!l.hsn && l.hsn.startsWith('99');
const tax = (l: EinvoiceLine) => l.heads.igst + l.heads.cgst + l.heads.sgst + l.heads.cess;

/** The lines that are goods: everything without a SAC code */
export const ewayGoods = (i: EinvoiceInput) => i.lines.filter((l) => !isService(l));

/** Whether moving the invoice's goods needs an e-way bill: their value with tax is over ₹50,000 */
export const ewayRequired = (i: EinvoiceInput) => i.currency === 'INR' && ewayGoods(i).reduce((s, l) => s + l.amount + tax(l), 0) > EWAY_THRESHOLD;

/** What the portal would refuse. Unlike e-invoices, the buyer may be unregistered */
export function ewayProblems(i: EinvoiceInput, t: EwayTransport): EwayProblem[] {
  const out: EwayProblem[] = [];
  if (i.currency !== 'INR') out.push({ code: 'not_inr' });
  if (!ewayGoods(i).length) out.push({ code: 'no_goods' });
  if (i.number.length > 16) out.push({ code: 'number_too_long' });
  if (!i.placeOfSupply) out.push({ code: 'no_place_of_supply' });
  for (const party of ['seller', 'buyer'] as const) {
    // Goods go to the ship-to address when there is one
    const p = party === 'buyer' && i.shipTo ? { ...i.shipTo, gstin: i.buyer.gstin } : i[party];
    if (party === 'seller' ? !p.gstin || !GSTIN.test(p.gstin) : !!p.gstin && !GSTIN.test(p.gstin)) out.push({ code: 'gstin', party });
    if (!cut(p.address1, 120)) out.push({ code: 'address', party });
    if (cut(p.city, 50).length < 3) out.push({ code: 'city', party });
    if (!p.pin || !PIN.test(p.pin.replace(/\s/g, ''))) out.push({ code: 'pin', party });
  }
  i.lines.forEach((l, n) => {
    if (!isService(l) && (!l.hsn || !/^\d{4,8}$/.test(l.hsn))) out.push({ code: 'hsn', line: n + 1 });
  });
  if (t.mode !== 'road' && !t.docNo) out.push({ code: 'transport_doc' });
  return out;
}

/** The portal's bulk JSON for one invoice; check ewayProblems first */
export function buildEwayBill(i: EinvoiceInput, t: EwayTransport) {
  const goods = ewayGoods(i);
  const sum = (f: (l: EinvoiceLine) => number) => goods.reduce((s, l) => s + f(l), 0);
  const pin = (p: string) => Number(p.replace(/\s/g, ''));
  const seller = i.seller;
  const buyer = i.buyer;
  const sellerState = Number(seller.gstin!.slice(0, 2));
  const pos = Number(i.placeOfSupply);
  // The main HSN is the one carrying the most value
  const byHsn = new Map<string, number>();
  for (const l of goods) byHsn.set(l.hsn!, (byHsn.get(l.hsn!) ?? 0) + l.amount);
  const mainHsn = [...byHsn].sort((a, b) => b[1] - a[1])[0]![0];
  const partB = t.mode === 'road' ? !!t.vehicleNo : !!t.docNo;
  return {
    userGstin: seller.gstin!,
    supplyType: 'O',
    subSupplyType: 1,
    subSupplyDesc: '',
    docType: 'INV',
    docNo: i.number,
    docDate: ddmmyyyy(i.date),
    // Bill to one place, ship to another
    transType: i.shipTo ? 2 : 1,
    fromGstin: seller.gstin!,
    fromTrdName: cut(seller.tradeName ?? seller.legalName, 100),
    fromAddr1: cut(seller.address1, 120),
    fromAddr2: cut(seller.address2, 120),
    fromPlace: cut(seller.city, 50),
    fromPincode: pin(seller.pin!),
    fromStateCode: sellerState,
    actualFromStateCode: sellerState,
    // An unregistered buyer is "URP"; the state is where the goods go
    toGstin: buyer.gstin ?? 'URP',
    toTrdName: cut(buyer.tradeName ?? buyer.legalName, 100),
    toAddr1: cut((i.shipTo ?? buyer).address1, 120),
    toAddr2: cut((i.shipTo ?? buyer).address2, 120),
    toPlace: cut((i.shipTo ?? buyer).city, 50),
    toPincode: pin((i.shipTo ?? buyer).pin!),
    toStateCode: buyer.gstin ? Number(buyer.gstin.slice(0, 2)) : pos,
    actualToStateCode: i.shipTo?.stateCode ? Number(i.shipTo.stateCode) : pos,
    totalValue: rupees(sum((l) => l.amount)),
    cgstValue: rupees(sum((l) => l.heads.cgst)),
    sgstValue: rupees(sum((l) => l.heads.sgst)),
    igstValue: rupees(sum((l) => l.heads.igst)),
    cessValue: rupees(sum((l) => l.heads.cess)),
    TotNonAdvolVal: 0,
    OthValue: 0,
    totInvValue: rupees(sum((l) => l.amount + tax(l))),
    transMode: partB ? MODE_CODE[t.mode] : '',
    transDistance: String(t.distanceKm),
    transporterName: cut(t.transporterName, 100),
    transporterId: t.transporterId ?? '',
    transDocNo: t.mode === 'road' ? '' : (t.docNo ?? ''),
    transDocDate: t.mode !== 'road' && t.docDate ? ddmmyyyy(t.docDate) : '',
    vehicleNo: t.mode === 'road' ? (t.vehicleNo ?? '') : '',
    vehicleType: t.mode === 'road' && t.vehicleNo ? 'R' : '',
    mainHsnCode: Number(mainHsn),
    itemList: goods.map((l, n) => {
      const igst = l.heads.igst > 0;
      const rate = Math.round(l.gstRate * 1000) / 1000;
      return {
        itemNo: n + 1,
        productName: cut(l.description, 100),
        productDesc: cut(l.description, 100),
        hsnCode: Number(l.hsn),
        quantity: Math.round(Number(l.quantity) * 1000) / 1000,
        qtyUnit: uqcOf(l.unit),
        taxableAmount: rupees(l.amount),
        sgstRate: igst ? 0 : rate / 2,
        cgstRate: igst ? 0 : rate / 2,
        igstRate: igst ? rate : 0,
        cessRate: l.amount ? Math.round((l.heads.cess / l.amount) * 100_000) / 1000 : 0,
        cessNonAdvol: 0,
      };
    }),
  };
}
export type EwayBill = ReturnType<typeof buildEwayBill>;

/** The file the portal's bulk upload takes */
export const ewayBillFile = (bills: EwayBill[]) => ({ version: '1.0.0621', billLists: bills });
