import { describe, expect, it } from 'vitest';
import { tallyGroup, tallyMastersXml, tallyVoucherType, tallyVouchersXml, uniqueLedgerNames } from './index.js';

describe('Tally export', () => {
  it('puts accounts in Tally’s own groups', () => {
    expect(tallyGroup('asset', 'bank')).toBe('Bank Accounts');
    expect(tallyGroup('liability', 'tax_payable')).toBe('Duties & Taxes');
    expect(tallyGroup('asset', 'current_asset', { taxAccount: true })).toBe('Duties & Taxes');
    expect(tallyGroup('income', 'operating_income')).toBe('Sales Accounts');
    expect(tallyGroup('expense', 'operating_expense')).toBe('Indirect Expenses');
    expect(tallyGroup('equity', 'something_new')).toBe('Capital Account');
  });

  it('chooses the voucher type Tally would', () => {
    const bank = (debit: number, credit: number) => ({ bank: true, debit, credit });
    const other = (debit: number, credit: number) => ({ bank: false, debit, credit });
    expect(tallyVoucherType([bank(100, 0), other(0, 100)], 'payment')).toBe('Receipt');
    expect(tallyVoucherType([other(100, 0), bank(0, 100)], 'payment')).toBe('Payment');
    expect(tallyVoucherType([bank(100, 0), bank(0, 100)], null)).toBe('Contra');
    expect(tallyVoucherType([other(118, 0), other(0, 100), other(0, 18)], 'invoice')).toBe('Sales');
    expect(tallyVoucherType([other(100, 0), other(0, 100)], 'bill')).toBe('Purchase');
    expect(tallyVoucherType([other(100, 0), other(0, 100)], 'credit_note')).toBe('Credit Note');
    expect(tallyVoucherType([other(100, 0), other(0, 100)], 'debit_note')).toBe('Debit Note');
    expect(tallyVoucherType([other(100, 0), other(0, 100)], null)).toBe('Journal');
  });

  it('writes masters and vouchers Tally imports: debits deemed positive with negative amounts, text escaped', () => {
    const masters = tallyMastersXml('Nest & Co', [{ name: 'Kumar Logistics', parent: 'Sundry Debtors', gstin: '27AAKCK4821R1Z4' }]);
    expect(masters).toContain('<REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>Nest &amp; Co</SVCURRENTCOMPANY>');
    expect(masters).toContain('<LEDGER NAME="Kumar Logistics" ACTION="Create"><NAME.LIST><NAME>Kumar Logistics</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAKCK4821R1Z4</PARTYGSTIN>');
    const vouchers = tallyVouchersXml('Nest & Co', [{ type: 'Sales', date: '2026-10-05', number: 'INV/2026-27/0001', narration: 'Freight <Pune>', lines: [{ ledger: 'Kumar Logistics', debit: 1_18_000_00, credit: 0 }, { ledger: 'Sales', debit: 0, credit: 1_00_000_00 }, { ledger: 'CGST output', debit: 0, credit: 9_000_00 }, { ledger: 'SGST output', debit: 0, credit: 9_000_00 }] }]);
    expect(vouchers).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>20261005</DATE>');
    expect(vouchers).toContain('<VOUCHERNUMBER>INV/2026-27/0001</VOUCHERNUMBER>');
    expect(vouchers).toContain('<NARRATION>Freight &lt;Pune&gt;</NARRATION>');
    expect(vouchers).toContain('<LEDGERNAME>Kumar Logistics</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-118000.00</AMOUNT>');
    expect(vouchers).toContain('<LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100000.00</AMOUNT>');
    // Balanced as Tally checks it: the amounts add up to zero
    const sum = [...vouchers.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(Math.abs(sum)).toBeLessThan(0.001);
  });

  it('keeps ledger names apart when an account and a contact share one', () => {
    const names = uniqueLedgerNames([
      { key: 'a1', name: 'Rent', suffix: '5300' },
      { key: 'c1', name: 'Kumar Logistics', suffix: 'customer' },
      { key: 'c2', name: 'Rent', suffix: 'vendor' },
    ]);
    expect([...names.values()]).toEqual(['Rent (5300)', 'Kumar Logistics', 'Rent (vendor)']);
  });
});
