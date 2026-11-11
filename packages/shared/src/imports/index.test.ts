import { describe, expect, it } from 'vitest';
import { guessImportMapping, parseImportDate, importAccountType, importContactKind, importSubtype, mapImportRows } from './index.js';

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

describe('parseImportDate', () => {
  it('reads the dates spreadsheets write in India, and refuses ones that don’t exist', () => {
    expect(parseImportDate('2026-03-31')).toBe('2026-03-31');
    expect(parseImportDate('31/03/2026')).toBe('2026-03-31');
    expect(parseImportDate('5-4-26')).toBe('2026-04-05');
    expect(parseImportDate('29.02.2028')).toBe('2028-02-29');
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(parseImportDate('March 31')).toBeNull();
  });

  it('guesses the columns of a Tally bill-wise outstanding report', () => {
    expect(guessImportMapping(['Date', 'Ref. No.', "Party's Name", 'Pending Amount', 'Due on'], 'opening_invoices')).toEqual({ party: 2, number: 1, date: 0, dueDate: 4, amount: 3 });
  });
});
