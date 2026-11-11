import { isUqc } from '../items/uqc.js';
import { z } from 'zod';
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
  /** For a ship-to address: its two-digit state code */
  stateCode?: string | null;
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
  /** Where the goods go, when not the buyer's billing address */
  shipTo?: EinvoiceParty | null;
  /** The total rounded to the rupee: the difference (paise) */
  roundOff?: number;
  /** An export or SEZ supply (with IGST or under LUT), or a deemed export */
  supplyKind?: string | null;
  /** For an export: shipping bill, port, country, and the currency it's billed in */
  exportDetails?: { portCode: string | null; shippingBillNo: string | null; shippingBillDate: string | null; countryCode: string | null } | null;
  foreignCurrency?: string | null;
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
/** An item's unit as a UQC: already one (chosen from the list), or worked out from what was typed */
export const uqcOf = (unit: string | null | undefined) => (isUqc(unit?.trim()) ? unit!.trim() : (unit && UQC[unit.trim().toLowerCase().replace(/\.$/, '')]) || 'OTH');

const rupees = (paise: number) => Math.round(paise) / 100;
const ddmmyyyy = (d: string) => d.split('-').reverse().join('/');
const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** What the portal would refuse, before building anything */
export function einvoiceProblems(i: EinvoiceInput): EinvoiceProblem[] {
  const out: EinvoiceProblem[] = [];
  if (i.currency !== 'INR') out.push({ code: 'not_inr' });
  if (!i.lines.length) out.push({ code: 'no_lines' });
  if (i.number.length > 16) out.push({ code: 'number_too_long' });
  const exporting = i.supplyKind === 'export_with_igst' || i.supplyKind === 'export_lut';
  if (!i.placeOfSupply && !exporting) out.push({ code: 'no_place_of_supply' });
  for (const party of ['seller', 'buyer'] as const) {
    const p = i[party];
    // A buyer abroad has no GSTIN or Indian PIN: the portal takes URP and 999999
    if (party === 'buyer' && exporting) {
      if (!cut(p.address1, 100)) out.push({ code: 'address', party });
      continue;
    }
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

/** The portal's supply type for each kind of supply */
const SUP_TYP: Record<string, string> = { regular: 'B2B', export_with_igst: 'EXPWP', export_lut: 'EXPWOP', sez_with_igst: 'SEZWP', sez_lut: 'SEZWOP', deemed_export: 'DEXP' };

/** The portal's JSON; check einvoiceProblems first */
export function buildEinvoice(i: EinvoiceInput) {
  const exporting = i.supplyKind === 'export_with_igst' || i.supplyKind === 'export_lut';
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
    TranDtls: { TaxSch: 'GST', SupTyp: SUP_TYP[i.supplyKind ?? 'regular'] ?? 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: i.kind === 'credit_note' ? 'CRN' : 'INV', No: i.number, Dt: ddmmyyyy(i.date) },
    SellerDtls: party(i.seller),
    BuyerDtls: exporting
      ? { Gstin: 'URP', LglNm: cut(i.buyer.legalName, 100), Addr1: cut(i.buyer.address1, 100), Loc: cut(i.buyer.city, 50) || 'Abroad', Pin: 999999, Stcd: '96', Pos: '96' }
      : { ...party(i.buyer), Pos: i.placeOfSupply! },
    ...(exporting && i.exportDetails
      ? {
          ExpDtls: {
            ...(i.exportDetails.shippingBillNo ? { ShipBNo: i.exportDetails.shippingBillNo } : {}),
            ...(i.exportDetails.shippingBillDate ? { ShipBDt: i.exportDetails.shippingBillDate.split('-').reverse().join('/') } : {}),
            ...(i.exportDetails.portCode ? { Port: i.exportDetails.portCode } : {}),
            ...(i.exportDetails.countryCode ? { CntCode: i.exportDetails.countryCode } : {}),
            ...(i.foreignCurrency ? { ForCur: i.foreignCurrency } : {}),
          },
        }
      : {}),
    // Goods delivered elsewhere: the ship-to address, its state from the address (it may have no GSTIN)
    ...(i.shipTo && i.shipTo.stateCode
      ? {
          ShipDtls: {
            ...(i.shipTo.gstin ? { Gstin: i.shipTo.gstin } : {}),
            LglNm: cut(i.shipTo.legalName, 100),
            Addr1: cut(i.shipTo.address1, 100),
            ...(cut(i.shipTo.address2, 100) ? { Addr2: cut(i.shipTo.address2, 100) } : {}),
            Loc: cut(i.shipTo.city, 50),
            Pin: Number((i.shipTo.pin ?? '0').replace(/\s/g, '')),
            Stcd: i.shipTo.stateCode,
          },
        }
      : {}),
    ItemList: items,
    ValDtls: {
      AssVal: rupees(sum((l) => l.amount)),
      CgstVal: rupees(sum((l) => l.heads.cgst)),
      SgstVal: rupees(sum((l) => l.heads.sgst)),
      IgstVal: rupees(sum((l) => l.heads.igst)),
      CesVal: rupees(sum((l) => l.heads.cess)),
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: rupees(i.roundOff ?? 0),
      TotInvVal: rupees(total + (i.roundOff ?? 0)),
    },
  };
}
export type Einvoice = ReturnType<typeof buildEinvoice>;

/** What the portal gives back for a registered e-invoice, to print on it */
export const einvoiceIrnSchema = z.object({
  irn: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, 'An IRN is 64 letters and digits.')
    .transform((v) => v.toLowerCase()),
  ackNo: z.string().trim().regex(/^\d{10,20}$/, 'The acknowledgement number is digits only.'),
  ackDate: z.string().trim().min(8).max(32),
  /** The signed QR code text (a signed token, three parts joined by dots) */
  signedQrCode: z
    .string()
    .trim()
    .max(4000)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'That isn’t the signed QR code from the portal.'),
});
export type EinvoiceIrnInput = z.input<typeof einvoiceIrnSchema>;

/** The IRN details from the portal's response (its JSON as downloaded or copied), or null if they aren't there */
export function irnFromPortal(json: unknown): EinvoiceIrnInput | null {
  const o = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const data = (o.Data ?? o.data ?? o) as Record<string, unknown>;
  const pick = (k: string) => (typeof data[k] === 'string' || typeof data[k] === 'number' ? String(data[k]) : null);
  const irn = pick('Irn');
  const ackNo = pick('AckNo');
  const ackDate = pick('AckDt');
  const signedQrCode = pick('SignedQRCode');
  return irn && ackNo && ackDate && signedQrCode ? { irn, ackNo, ackDate, signedQrCode } : null;
}
