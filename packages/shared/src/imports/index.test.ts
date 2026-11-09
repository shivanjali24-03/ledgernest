import { describe, expect, it } from 'vitest';
import { guessImportMapping, importAccountType, importContactKind, importSubtype, mapImportRows } from './index.js';

describe('imports', () => {
  it('guesses the columns from the headers, each used once', () => {
    const m = guessImportMapping(['Account Code', 'Account Name', 'Type', 'Parent'], 'accounts');
    expect(m).toMatchObject({ code: 0, name: 1, type: 2, parentCode: 3, subtype: null });
    expect(mapImportRows([['1100', ' Bank ', 'Assets', ''], ['', '', '', '']], m)).toEqual([{ code: '1100', name: 'Bank', type: 'Assets', parentCode: '' }]);
  });
  it('reads account types, sub-types and contact kinds the way people write them', () => {
    expect(importAccountType('Liabilities')).toBe('liability');
    expect(importAccountType('revenue')).toBe('income');
    expect(importAccountType('stuff')).toBeNull();
    expect(importSubtype('asset', 'Fixed asset')).toBe('fixed_asset');
    expect(importSubtype('asset', '')).toBe('current_asset');
    expect(importSubtype('asset', 'payroll')).toBeNull();
    expect(importContactKind('Supplier')).toEqual({ isCustomer: false, isVendor: true });
    expect(importContactKind('')).toEqual({ isCustomer: true, isVendor: false });
    expect(importContactKind('friend')).toBeNull();
  });
});
