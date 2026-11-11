import { describe, expect, it } from 'vitest';
import type { EinvoiceInput } from '../einvoice/index.js';
import { buildEwayBill, ewayBillFile, ewayProblems, ewayRequired, ewayTransportSchema } from './index.js';

const input = (over: Partial<EinvoiceInput> = {}): EinvoiceInput => ({
  kind: 'invoice',
  number: 'INV/2026-27/0042',
  date: '2026-10-05',
  currency: 'INR',
  placeOfSupply: '29',
  seller: { gstin: '27AAPFN1234C1Z5', legalName: 'Nest Demo Private Limited', tradeName: 'Nest Demo', address1: '4th Floor, Riverside Business Bay', address2: 'Baner Road', city: 'Pune', pin: '411045' },
  buyer: { gstin: '29AAKCK4821R1Z4', legalName: 'Kumar Logistics Private Limited', address1: 'Plot 18, Peenya Industrial Area', city: 'Bengaluru', pin: '560 058' },
  lines: [
    { description: 'Installation', hsn: '998732', quantity: '1', unit: null, unitPrice: 10_000_00, amount: 10_000_00, heads: { igst: 1_800_00, cgst: 0, sgst: 0, cess: 0 }, gstRate: 18 },
    { description: 'Dell Latitude 5440', hsn: '84713010', quantity: '2', unit: 'Nos', unitPrice: 72_000_00, amount: 1_44_000_00, heads: { igst: 25_920_00, cgst: 0, sgst: 0, cess: 0 }, gstRate: 18 },
    { description: 'Laptop bags', hsn: '42021290', quantity: '2', unit: 'pcs', unitPrice: 1_500_00, amount: 3_000_00, heads: { igst: 360_00, cgst: 0, sgst: 0, cess: 0 }, gstRate: 12 },
  ],
  ...over,
});
const road = ewayTransportSchema.parse({ distanceKm: 840, vehicleNo: 'mh 12 ab-1234', transporterName: 'VRL Logistics' });

describe('E-way bill JSON', () => {
  it('builds the portal’s bulk format from the goods only, with Part B when a vehicle is given', () => {
    const b = buildEwayBill(input(), road);
    expect(b).toMatchObject({
      userGstin: '27AAPFN1234C1Z5',
      supplyType: 'O',
      subSupplyType: 1,
      docType: 'INV',
      docNo: 'INV/2026-27/0042',
      docDate: '05/10/2026',
      fromTrdName: 'Nest Demo',
      fromPincode: 411045,
      fromStateCode: 27,
      toGstin: '29AAKCK4821R1Z4',
      toPincode: 560058,
      toStateCode: 29,
      actualToStateCode: 29,
      totalValue: 147000,
      igstValue: 26280,
      cgstValue: 0,
      totInvValue: 173280,
      transMode: '1',
      transDistance: '840',
      vehicleNo: 'MH12AB1234',
      vehicleType: 'R',
      transporterName: 'VRL Logistics',
      mainHsnCode: 84713010,
    });
    expect(b.itemList).toEqual([
      { itemNo: 1, productName: 'Dell Latitude 5440', productDesc: 'Dell Latitude 5440', hsnCode: 84713010, quantity: 2, qtyUnit: 'NOS', taxableAmount: 144000, sgstRate: 0, cgstRate: 0, igstRate: 18, cessRate: 0, cessNonAdvol: 0 },
      expect.objectContaining({ itemNo: 2, hsnCode: 42021290, qtyUnit: 'PCS', igstRate: 12 }),
    ]);
    expect(ewayBillFile([b])).toEqual({ version: '1.0.0621', billLists: [b] });
  });

  it('leaves Part B empty without a vehicle, and splits rates for a sale within the state', () => {
    const local = input({ placeOfSupply: '27', buyer: { gstin: null, legalName: 'Walk-in buyer', address1: 'Shop 4, FC Road', city: 'Pune', pin: '411004' }, lines: [{ ...input().lines[1]!, heads: { igst: 0, cgst: 12_960_00, sgst: 12_960_00, cess: 0 } }] });
    const b = buildEwayBill(local, ewayTransportSchema.parse({}));
    expect(b).toMatchObject({ toGstin: 'URP', toStateCode: 27, transMode: '', vehicleNo: '', vehicleType: '', transDistance: '0', cgstValue: 12960, sgstValue: 12960 });
    expect(b.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0 });
  });

  it('sends goods to the ship-to address as Bill To - Ship To, and checks that address', async () => {
    const shipTo = { gstin: null, legalName: 'Kumar Warehouse', address1: 'Plot 4, Hosur Road', city: 'Hosur', pin: '635109', stateCode: '33' };
    const bill = buildEwayBill(input({ shipTo }), road);
    expect(bill).toMatchObject({ transType: 2, toPlace: 'Hosur', toPincode: 635109, actualToStateCode: 33, toStateCode: 29, toGstin: '29AAKCK4821R1Z4' });
    expect(ewayProblems(input({ shipTo: { ...shipTo, pin: '1234' } }), road)).toContainEqual({ code: 'pin', party: 'buyer' });
    const { buildEinvoice } = await import('../einvoice/index.js');
    expect(buildEinvoice(input({ shipTo })).ShipDtls).toEqual({ LglNm: 'Kumar Warehouse', Addr1: 'Plot 4, Hosur Road', Loc: 'Hosur', Pin: 635109, Stcd: '33' });
    expect(buildEinvoice(input()).ShipDtls).toBeUndefined();
  });

  it('is needed for goods over ₹50,000 with tax, whatever the services come to', () => {
    expect(ewayRequired(input())).toBe(true);
    expect(ewayRequired(input({ lines: [input().lines[2]!] }))).toBe(false);
    expect(ewayRequired(input({ lines: [{ ...input().lines[0]!, amount: 9_00_000_00 }] }))).toBe(false);
    expect(ewayRequired(input({ currency: 'USD' }))).toBe(false);
  });

  it('finds what the portal would refuse; an unregistered buyer is fine', () => {
    expect(ewayProblems(input(), road)).toEqual([]);
    expect(ewayProblems(input({ buyer: { ...input().buyer, gstin: null } }), road)).toEqual([]);
    const bad = input({
      placeOfSupply: null,
      seller: { gstin: null, legalName: 'X', address1: null, city: 'Pune', pin: '41104' },
      buyer: { gstin: 'nope', legalName: 'Y', address1: 'Road', city: 'Pu', pin: '560058' },
      lines: [input().lines[0]!, { ...input().lines[1]!, hsn: null }],
    });
    expect(ewayProblems(bad, ewayTransportSchema.parse({ mode: 'rail' }))).toEqual([
      { code: 'no_place_of_supply' },
      { code: 'gstin', party: 'seller' },
      { code: 'address', party: 'seller' },
      { code: 'pin', party: 'seller' },
      { code: 'gstin', party: 'buyer' },
      { code: 'city', party: 'buyer' },
      { code: 'hsn', line: 2 },
      { code: 'transport_doc' },
    ]);
    expect(ewayProblems(input({ lines: [input().lines[0]!] }), road)).toEqual([{ code: 'no_goods' }]);
  });

  it('checks the transport details people type', () => {
    expect(ewayTransportSchema.safeParse({ vehicleNo: '12' }).success).toBe(false);
    expect(ewayTransportSchema.safeParse({ distanceKm: 5000 }).success).toBe(false);
    expect(ewayTransportSchema.parse({ vehicleNo: '  ', transporterId: '' })).toMatchObject({ mode: 'road', distanceKm: 0, vehicleNo: null, transporterId: null });
    const rail = buildEwayBill(input(), ewayTransportSchema.parse({ mode: 'rail', docNo: 'RR4471', docDate: '2026-10-06', vehicleNo: 'MH12AB1234' }));
    expect(rail).toMatchObject({ transMode: '2', transDocNo: 'RR4471', transDocDate: '06/10/2026', vehicleNo: '' });
  });
});
