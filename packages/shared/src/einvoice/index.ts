import type { GstHeads } from '../taxes/index.js';

/**
 * GST e-invoices: an invoice as the JSON the Invoice Registration Portal takes (NIC schema version 1.1), for
 * businesses that must register B2B invoices for an IRN. Upload it on the portal (or through a GST Suvidha
 * Provider); the IRN and signed QR code come back from there. Before building, everything the portal insists on is
 * checked, so a missing PIN code or HSN shows up here instead of as a rejection there.
 */

export interface EinvoiceParty {
  gstin: string | null;
  legalName: string;
  tradeName?: string | null;
  address1: string | null;
  address2?: string | null;
  /** Town or city ("Loc") */
  city: string | null;
  pin: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface EinvoiceLine {
  description: string;
  hsn: string | null;
  /** As typed, e.g. "40" or "2.5" */
  quantity: string;
  unit: string | null;
  /** Paise */
  unitPrice: number;
  /** After discount, before tax (paise) */
  amount: number;
  heads: GstHeads;
  /** Combined GST rate, e.g. 18 for CGST 9% + SGST 9% */
  gstRate: number;
}

export interface EinvoiceInput {
  kind: 'invoice' | 'credit_note';
  number: string;
  /** yyyy-mm-dd */
  date: string;
  currency: string;
  /** Two-digit state code of the place of supply */
  placeOfSupply: string | null;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  lines: EinvoiceLine[];
}

export type EinvoiceProblem =
  | { code: 'not_inr' | 'no_lines' | 'number_too_long' | 'no_place_of_supply' }
  | { code: 'gstin' | 'address' | 'city' | 'pin'; party: 'seller' | 'buyer' }
  | { code: 'hsn'; line: number };

const GSTIN = /^\d{2}[A-Z0-9]{13}$/;
const PIN = /^[1-9]\d{5}$/;

/** Units of quantity the portal knows (UQC), from the units people type */
const UQC: Record<string, string> = { nos: 'NOS', no: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', unit: 'UNT', units: 'UNT', kg: 'KGS', kgs: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT', m: 'MTR', mtr: 'MTR', metre: 'MTR', meter: 'MTR', box: 'BOX', boxes: 'BOX', dozen: 'DOZ', doz: 'DOZ', set: 'SET', sets: 'SET', pair: 'PRS', pairs: 'PRS', bag: 'BAG', bags: 'BAG', bottle: 'BTL', bottles: 'BTL', ton: 'TON', tonne: 'TON', sqm: 'SQM', sqft: 'SQF' };
export const uqcOf = (unit: string | null | undefined) => (unit && UQC[unit.trim().toLowerCase().replace(/\.$/, '')]) || 'OTH';

const rupees = (paise: number) => Math.round(paise) / 100;
const ddmmyyyy = (d: string) => d.split('-').reverse().join('/');
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** What the portal would refuse, before building anything */
export function einvoiceProblems(i: EinvoiceInput): EinvoiceProblem[] {
  const out: EinvoiceProblem[] = [];
  if (i.currency !== 'INR') out.push({ code: 'not_inr' });
  if (!i.lines.length) out.push({ code: 'no_lines' });
  if (i.number.length > 16) out.push({ code: 'number_too_long' });
  if (!i.placeOfSupply) out.push({ code: 'no_place_of_supply' });
  for (const party of ['seller', 'buyer'] as const) {
    const p = i[party];
    if (!p.gstin || !GSTIN.test(p.gstin)) out.push({ code: 'gstin', party });
    if (!cut(p.address1, 100)) out.push({ code: 'address', party });
    if (cut(p.city, 50).length < 3) out.push({ code: 'city', party });
    if (!p.pin || !PIN.test(p.pin.replace(/\s/g, ''))) out.push({ code: 'pin', party });
  }
  i.lines.forEach((l, n) => {
    if (!l.hsn || !/^\d{4,8}$/.test(l.hsn)) out.push({ code: 'hsn', line: n + 1 });
  });
  return out;
}

/** The portal's JSON; check einvoiceProblems first */
export function buildEinvoice(i: EinvoiceInput) {
  const party = (p: EinvoiceParty) => ({
    Gstin: p.gstin!,
    LglNm: cut(p.legalName, 100),
    ...(p.tradeName ? { TrdNm: cut(p.tradeName, 100) } : {}),
    Addr1: cut(p.address1, 100),
    ...(cut(p.address2, 100) ? { Addr2: cut(p.address2, 100) } : {}),
    Loc: cut(p.city, 50),
    Pin: Number(p.pin!.replace(/\s/g, '')),
    // The state comes from the GSTIN, which can't be out of date with itself
    Stcd: p.gstin!.slice(0, 2),
    ...(p.phone && p.phone.replace(/\D/g, '').length >= 6 ? { Ph: p.phone.replace(/\D/g, '').slice(-12) } : {}),
    ...(p.email ? { Em: cut(p.email, 100) } : {}),
  });
  const items = i.lines.map((l, n) => {
    const qty = Number(l.quantity);
    const gross = Math.round(qty * l.unitPrice);
    const tax = l.heads.igst + l.heads.cgst + l.heads.sgst + l.heads.cess;
    return {
      SlNo: String(n + 1),
      PrdDesc: cut(l.description, 300),
      IsServc: l.hsn!.startsWith('99') ? 'Y' : 'N',
      HsnCd: l.hsn!,
      Qty: Math.round(qty * 1000) / 1000,
      Unit: uqcOf(l.unit),
      UnitPrice: rupees(l.unitPrice),
      TotAmt: rupees(gross),
      Discount: rupees(Math.max(0, gross - l.amount)),
      AssAmt: rupees(l.amount),
      GstRt: Math.round(l.gstRate * 1000) / 1000,
      IgstAmt: rupees(l.heads.igst),
      CgstAmt: rupees(l.heads.cgst),
      SgstAmt: rupees(l.heads.sgst),
      CesAmt: rupees(l.heads.cess),
      TotItemVal: rupees(l.amount + tax),
    };
  });
  const sum = (f: (l: EinvoiceLine) => number) => i.lines.reduce((s, l) => s + f(l), 0);
  const total = sum((l) => l.amount + l.heads.igst + l.heads.cgst + l.heads.sgst + l.heads.cess);
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: i.kind === 'credit_note' ? 'CRN' : 'INV', No: i.number, Dt: ddmmyyyy(i.date) },
    SellerDtls: party(i.seller),
    BuyerDtls: { ...party(i.buyer), Pos: i.placeOfSupply! },
    ItemList: items,
    ValDtls: {
      AssVal: rupees(sum((l) => l.amount)),
      CgstVal: rupees(sum((l) => l.heads.cgst)),
      SgstVal: rupees(sum((l) => l.heads.sgst)),
      IgstVal: rupees(sum((l) => l.heads.igst)),
      CesVal: rupees(sum((l) => l.heads.cess)),
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: rupees(total),
    },
  };
}
export type Einvoice = ReturnType<typeof buildEinvoice>;
