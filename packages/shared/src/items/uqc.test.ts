import { describe, expect, it } from 'vitest';
import { uqcOf } from '../einvoice/index.js';
import { gtinValid, isUqc, itemCreateSchema, UQC_CODES } from './index.js';

describe('Item details for India', () => {
  it('lists GST’s units of quantity, and keeps a chosen one as it is in returns', () => {
    expect(UQC_CODES).toContain('NOS');
    expect(UQC_CODES).toHaveLength(45);
    expect(isUqc('KGS')).toBe(true);
    expect(isUqc('kg')).toBe(false);
    expect(uqcOf('KGS')).toBe('KGS');
    expect(uqcOf('QTL')).toBe('QTL');
    // Units typed before the list still map
    expect(uqcOf('kg')).toBe('KGS');
    expect(uqcOf('hrs')).toBe('OTH');
  });

  it('checks the check digit of retail barcodes, and lets a shop’s own codes through', () => {
    expect(['8901030865275', '036000291452', '96385074', '10012345678902'].map(gtinValid)).toEqual([true, true, true, true]);
    expect(gtinValid('8901030865278')).toBe(false);
    expect(gtinValid('SHOP-0042')).toBe(true);
    expect(itemCreateSchema.safeParse({ name: 'Tea', barcode: '8901030865278' }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: 'Tea', barcode: 'ab' }).success).toBe(false);
    expect(itemCreateSchema.parse({ name: 'Tea', kind: 'goods', unit: 'PAC', mrp: 120_00, barcode: '8901030865275', brand: ' Tata ', category: 'Beverages' })).toMatchObject({
      unit: 'PAC',
      mrp: 120_00,
      barcode: '8901030865275',
      brand: 'Tata',
      category: 'Beverages',
    });
  });
});
