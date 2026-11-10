import { describe, expect, it } from 'vitest';
import { docKey, Gstr2bError, gstr2bRequestSchema, gstr2bRows, parseGstr2b, reconcileGstr2b, type Gstr2bBill } from './gstr2b.js';

// The shape the GST portal downloads, trimmed to what matters
const SHARMA = '27ABZPS6519M1ZQ';
const KARNATAKA = '29AAACB1234C1Z5';
const portal = {
  chksum: 'x',
  data: {
    gstin: '27AAPFN1234C1Z5',
    rtnprd: '102026',
    gendt: '14-11-2026',
    docdata: {
      b2b: [
        {
          ctin: SHARMA,
          trdnm: 'SHARMA OFFICE SUPPLIES',
          supfildt: '11-11-2026',
          supprd: '102026',
          inv: [
            // Matches a bill exactly (number written differently)
            { inum: 'SOS/0042/26-27', dt: '05-10-2026', val: 11800, pos: '27', rev: 'N', itcavl: 'Y', rsn: '', typ: 'R', items: [{ num: 1, rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 }] },
            // In the books for less
            { inum: 'SOS/43/26-27', dt: '12-10-2026', val: 5900, pos: '27', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 }] },
            // Never booked
            { inum: 'SOS/44/26-27', dt: '20-10-2026', val: 2360, pos: '27', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 2000, igst: 0, cgst: 180, sgst: 180, cess: 0 }] },
          ],
        },
        {
          ctin: KARNATAKA,
          trdnm: 'BLUEWAVE CLOUD',
          inv: [
            // Booked with the number mistyped: a probable match
            { inum: 'BW-7781', dt: '01-10-2026', val: 35400.5, pos: '27', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 30000.42, igst: 5400.08, cgst: 0, sgst: 0, cess: 0 }] },
          ],
        },
      ],
      cdnr: [{ ctin: SHARMA, trdnm: 'SHARMA OFFICE SUPPLIES', nt: [{ ntnum: 'CN-3', typ: 'C', dt: '25-10-2026', val: 1180, rev: 'N', itcavl: 'Y', items: [{ txval: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 }] }] }],
    },
  },
};

const bill = (over: Partial<Gstr2bBill>): Gstr2bBill => ({ id: crypto.randomUUID(), number: 'BILL/2026-27/0001', vendorReference: null, vendorName: 'Sharma Office Supplies', vendorGstin: SHARMA, date: '2026-10-05', taxable: 0, heads: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, total: 0, ...over });

describe('GSTR-2B', () => {
  it('reads the portal’s JSON into paise, ISO dates and documents', () => {
    const f = parseGstr2b(`﻿${JSON.stringify(portal)}`);
    expect(f).toMatchObject({ gstin: '27AAPFN1234C1Z5', period: '102026' });
    expect(f.docs).toHaveLength(5);
    expect(f.docs[0]).toEqual({ kind: 'invoice', supplierGstin: SHARMA, supplierName: 'SHARMA OFFICE SUPPLIES', number: 'SOS/0042/26-27', date: '2026-10-05', taxable: 10000_00, heads: { igst: 0, cgst: 900_00, sgst: 900_00, cess: 0 }, total: 11800_00, itcAvailable: true, reverseCharge: false });
    expect(f.docs[3]).toMatchObject({ taxable: 3000042, heads: { igst: 540008 }, total: 3540050 });
    expect(f.docs[4]).toMatchObject({ kind: 'credit_note', number: 'CN-3', total: 1180_00 });
  });

  it('refuses what isn’t GSTR-2B JSON', () => {
    expect(() => parseGstr2b('not json')).toThrow(Gstr2bError);
    expect(() => parseGstr2b('{"data":{"gstin":"x"}}')).toThrow(expect.objectContaining({ reason: 'not_gstr2b' }));
    expect(() => parseGstr2b('[]')).toThrow(expect.objectContaining({ reason: 'not_gstr2b' }));
  });

  it('treats invoice numbers written differently as the same', () => {
    expect(docKey('SOS/0042/26-27')).toBe(docKey('sos-42/2627'));
    expect(docKey('INV 001')).toBe('INV1');
    expect(docKey('A-10')).not.toBe(docKey('A-1'));
    expect(docKey('000')).toBe('0');
  });

  it('matches, flags differences, finds probable matches and what’s missing on each side', () => {
    const f = parseGstr2b(JSON.stringify(portal));
    const bills = [
      bill({ number: 'BILL/0001', vendorReference: 'sos-42/2627', date: '2026-10-05', taxable: 10000_00, heads: { igst: 0, cgst: 900_00, sgst: 900_00, cess: 0 }, total: 11800_00 }),
      bill({ number: 'BILL/0002', vendorReference: 'SOS/43/26-27', date: '2026-10-12', taxable: 4000_00, heads: { igst: 0, cgst: 360_00, sgst: 360_00, cess: 0 }, total: 4720_00 }),
      bill({ number: 'BILL/0003', vendorReference: 'BW7718', vendorName: 'Bluewave Cloud', vendorGstin: KARNATAKA, date: '2026-10-02', taxable: 3000042, heads: { igst: 540008, cgst: 0, sgst: 0, cess: 0 }, total: 3540050 }),
      // Booked, with GST, but the supplier hasn't filed it
      bill({ number: 'BILL/0004', vendorReference: 'SOS/45/26-27', date: '2026-10-28', taxable: 1000_00, heads: { igst: 0, cgst: 90_00, sgst: 90_00, cess: 0 }, total: 1180_00 }),
      // Left out: no GSTIN, or no GST
      bill({ number: 'BILL/0005', vendorGstin: null, heads: { igst: 0, cgst: 50_00, sgst: 50_00, cess: 0 } }),
      bill({ number: 'BILL/0006', vendorReference: 'RENT-OCT', taxable: 25000_00, total: 25000_00 }),
    ];
    const r = reconcileGstr2b(f.docs, bills);
    expect(r.skipped).toBe(2);
    const by = (s: string) => r.rows.filter((x) => x.status === s);
    expect(by('matched').map((x) => x.bill!.number)).toEqual(['BILL/0001']);
    expect(by('mismatch')).toEqual([expect.objectContaining({ bill: expect.objectContaining({ number: 'BILL/0002' }), diff: { taxable: 1000_00, tax: 180_00 }, problems: ['taxable', 'tax'] })]);
    expect(by('probable')).toEqual([expect.objectContaining({ bill: expect.objectContaining({ number: 'BILL/0003' }), problems: ['number'] })]);
    // The supplier's credit note isn't in the books either: input credit to give back
    expect(by('missing_in_books').map((x) => x.doc!.number)).toEqual(['SOS/44/26-27', 'CN-3']);
    expect(by('missing_in_2b').map((x) => x.bill!.number)).toEqual(['BILL/0004']);
    expect(by('note')).toEqual([]);
    // Worst first
    expect(r.rows.map((x) => x.status)).toEqual(['mismatch', 'missing_in_2b', 'missing_in_books', 'missing_in_books', 'probable', 'matched']);
    expect(r.summary).toMatchObject({ matched: { count: 1, tax: 1800_00 }, missing_in_2b: { count: 1, tax: 180_00 }, missing_in_books: { count: 2, tax: 180_00 }, note: { count: 0, tax: 0 } });
  });

  it('sees IGST against CGST + SGST as a wrong place of supply, allows rupee rounding, and notes a date only', () => {
    const doc = parseGstr2b(JSON.stringify(portal)).docs[0]!;
    const igst = reconcileGstr2b([doc], [bill({ vendorReference: doc.number, taxable: 10000_00, heads: { igst: 1800_00, cgst: 0, sgst: 0, cess: 0 }, total: 11800_00 })]);
    expect(igst.rows[0]).toMatchObject({ status: 'mismatch', problems: ['tax_type'] });
    const close = reconcileGstr2b([doc], [bill({ vendorReference: doc.number, date: '2026-10-06', taxable: 10000_40, heads: { igst: 0, cgst: 900_00, sgst: 899_60, cess: 0 }, total: 11800_00 })]);
    expect(close.rows[0]).toMatchObject({ status: 'matched', problems: ['date'] });
  });

  it('writes rows for a spreadsheet, and checks the request', () => {
    const f = parseGstr2b(JSON.stringify(portal));
    const rows = gstr2bRows(reconcileGstr2b(f.docs, []));
    expect(rows[0]![0]).toBe('Status');
    expect(rows[1]).toEqual(['Not in the books', KARNATAKA, 'BLUEWAVE CLOUD', 'BW-7781', '2026-10-01', '30000.42', '5400.08', '', '', '', '', '', '', '', '']);
    expect(gstr2bRequestSchema.safeParse({ content: '{}', from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(gstr2bRequestSchema.safeParse({ content: '{}', from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
  });

  it('matches the supplier’s credit notes to debit notes carrying their number, and flags the ones not in the books', () => {
    const f = parseGstr2b(JSON.stringify(portal));
    const note = (over: Partial<Gstr2bBill>): Gstr2bBill => bill({ kind: 'debit_note', number: 'DN/2026-27/0001', ...over });
    // Sharma's CN-3: ₹1,000 + ₹180 GST
    const matched = reconcileGstr2b(f.docs, [], 100, [note({ vendorReference: 'cn 3', date: '2026-10-25', taxable: 1000_00, heads: { igst: 0, cgst: 90_00, sgst: 90_00, cess: 0 }, total: 1180_00 })]);
    expect(matched.rows.find((r) => r.doc?.kind === 'credit_note')).toMatchObject({ status: 'matched', bill: { kind: 'debit_note', number: 'DN/2026-27/0001' } });
    const missing = reconcileGstr2b(f.docs, [], 100, []);
    expect(missing.rows.find((r) => r.doc?.kind === 'credit_note')).toMatchObject({ status: 'missing_in_books', bill: null });
  });
});
