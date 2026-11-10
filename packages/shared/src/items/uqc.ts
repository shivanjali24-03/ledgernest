/**
 * GST's units of quantity (UQC), as GSTR-1's HSN summary, e-invoices and e-way bills want them. An item's unit is
 * chosen from these, so its returns never need guessing.
 */
export const UQC_UNITS = [
  ['BAG', 'Bags'],
  ['BAL', 'Bale'],
  ['BDL', 'Bundles'],
  ['BKL', 'Buckles'],
  ['BOU', 'Billion of units'],
  ['BOX', 'Box'],
  ['BTL', 'Bottles'],
  ['BUN', 'Bunches'],
  ['CAN', 'Cans'],
  ['CBM', 'Cubic metres'],
  ['CCM', 'Cubic centimetres'],
  ['CMS', 'Centimetres'],
  ['CTN', 'Cartons'],
  ['DOZ', 'Dozens'],
  ['DRM', 'Drums'],
  ['GGK', 'Great gross'],
  ['GMS', 'Grams'],
  ['GRS', 'Gross'],
  ['GYD', 'Gross yards'],
  ['KGS', 'Kilograms'],
  ['KLR', 'Kilolitres'],
  ['KME', 'Kilometres'],
  ['LTR', 'Litres'],
  ['MLT', 'Millilitres'],
  ['MTR', 'Metres'],
  ['MTS', 'Metric tons'],
  ['NOS', 'Numbers'],
  ['PAC', 'Packs'],
  ['PCS', 'Pieces'],
  ['PRS', 'Pairs'],
  ['QTL', 'Quintals'],
  ['ROL', 'Rolls'],
  ['SET', 'Sets'],
  ['SQF', 'Square feet'],
  ['SQM', 'Square metres'],
  ['SQY', 'Square yards'],
  ['TBS', 'Tablets'],
  ['TGM', 'Ten gross'],
  ['THD', 'Thousands'],
  ['TON', 'Tonnes'],
  ['TUB', 'Tubes'],
  ['UGS', 'US gallons'],
  ['UNT', 'Units'],
  ['YDS', 'Yards'],
  ['OTH', 'Others'],
] as const;
export type UqcCode = (typeof UQC_UNITS)[number][0];
export const UQC_CODES = UQC_UNITS.map((u) => u[0]) as UqcCode[];
export const isUqc = (v: string | null | undefined): v is UqcCode => !!v && (UQC_CODES as string[]).includes(v);

/**
 * Whether a barcode's check digit is right, for the numeric GTINs on retail goods (EAN-8, UPC-A, EAN-13, GTIN-14).
 * Other barcodes (a shop's own codes, Code 128 with letters) have no check digit to test and pass.
 */
export function gtinValid(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return true;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
