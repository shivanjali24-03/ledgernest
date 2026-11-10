import { describe, expect, it } from 'vitest';
import { parseTallyXml, tallyAmount, tallyImportPlan, tallyPrimary } from './import.js';

// A trimmed "List of Accounts" export from Tally Prime
const XML = `<?xml version="1.0"?>
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><GROUP NAME="Pune Customers" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><GROUP NAME="Office Costs" RESERVEDNAME=""><PARENT>Indirect Expenses</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Kumar Logistics Pvt Ltd" RESERVEDNAME="">
 <ADDRESS.LIST TYPE="String"><ADDRESS>Plot 18, Hinjewadi Phase 2</ADDRESS><ADDRESS>Pune</ADDRESS></ADDRESS.LIST>
 <PARENT>Pune Customers</PARENT><EMAIL>accounts@kumar.example</EMAIL><LEDGERMOBILE>9822031144</LEDGERMOBILE>
 <LEDSTATENAME>Maharashtra</LEDSTATENAME><PINCODE>411057</PINCODE><PARTYGSTIN>27aakck4821r1z4</PARTYGSTIN>
 <BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD><OPENINGBALANCE>-1,18,000.00</OPENINGBALANCE>
</LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Sharma &amp; Sons" RESERVEDNAME=""><PARENT>Sundry Creditors</PARENT><OPENINGBALANCE>45000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="HDFC Bank A/c 4471" RESERVEDNAME=""><PARENT>Bank Accounts</PARENT><OPENINGBALANCE>-2,50,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Cash" RESERVEDNAME=""><PARENT>Cash-in-Hand</PARENT><OPENINGBALANCE>-12,500.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Office Rent" RESERVEDNAME=""><PARENT>Office Costs</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Output CGST" RESERVEDNAME=""><PARENT>Duties &amp; Taxes</PARENT><OPENINGBALANCE>9,000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Capital A/c" RESERVEDNAME=""><PARENT>Capital Account</PARENT><OPENINGBALANCE>3,26,500.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Profit &amp; Loss A/c" RESERVEDNAME="Profit &amp; Loss A/c"><PARENT>&#4; Primary</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Mystery" RESERVEDNAME=""><PARENT>Somewhere Odd</PARENT></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

describe('Importing from Tally', () => {
  it('reads amounts the way Tally writes them: debits negative', () => {
    expect(tallyAmount('-1,18,000.00')).toBe(1_18_000_00);
    expect(tallyAmount('45000.00')).toBe(-45_000_00);
    expect(tallyAmount('₹ -500.50 Dr')).toBe(500_50);
    expect(tallyAmount(null)).toBe(0);
  });

  it('reads groups and ledgers with their party details', () => {
    const m = parseTallyXml(XML);
    expect(m.groups.get('Pune Customers')).toBe('Sundry Debtors');
    const kumar = m.ledgers.find((l) => l.name === 'Kumar Logistics Pvt Ltd')!;
    expect(kumar).toEqual({ name: 'Kumar Logistics Pvt Ltd', parent: 'Pune Customers', opening: 1_18_000_00, gstin: '27AAKCK4821R1Z4', email: 'accounts@kumar.example', phone: '9822031144', address: 'Plot 18, Hinjewadi Phase 2, Pune', state: 'Maharashtra', pincode: '411057', creditDays: 30 });
    expect(m.ledgers.find((l) => l.name === 'Sharma & Sons')?.opening).toBe(-45_000_00);
    expect(tallyPrimary('Office Costs', m.groups)).toEqual({ type: 'expense', subtype: 'operating_expense' });
  });

  it('plans accounts, parties and balancing opening balances, reusing accounts already there', () => {
    const plan = tallyImportPlan(parseTallyXml(XML), [
      { code: '1100', name: 'HDFC Bank A/c 4471', type: 'asset', subtype: 'bank' },
      { code: '1300', name: 'Accounts receivable', type: 'asset', subtype: 'accounts_receivable' },
      { code: '1500', name: 'Taken', type: 'asset', subtype: 'current_asset' },
    ]);
    expect(plan.accounts).toEqual([
      { code: '1501', name: 'Cash', type: 'asset', subtype: 'cash' },
      { code: '5500', name: 'Office Rent', type: 'expense', subtype: 'operating_expense' },
      { code: '2500', name: 'Output CGST', type: 'liability', subtype: 'tax_payable' },
      { code: '3500', name: 'Capital A/c', type: 'equity', subtype: 'owner_equity' },
      { code: '2501', name: 'Sundry Creditors', type: 'liability', subtype: 'accounts_payable' },
    ]);
    expect(plan.matched).toEqual(['HDFC Bank A/c 4471']);
    expect(plan.contacts).toEqual([
      { name: 'Kumar Logistics Pvt Ltd', kind: 'customer', taxId: '27AAKCK4821R1Z4', email: 'accounts@kumar.example', phone: '9822031144', line1: 'Plot 18, Hinjewadi Phase 2, Pune', region: 'Maharashtra', postalCode: '411057', country: 'IN', paymentTermsDays: '30' },
      { name: 'Sharma & Sons', kind: 'vendor' },
    ]);
    expect(plan.openings).toEqual([
      { accountCode: '1100', debit: '250000.00' },
      { accountCode: '1501', debit: '12500.00' },
      { accountCode: '2500', credit: '9000.00' },
      { accountCode: '3500', credit: '326500.00' },
      { accountCode: '1300', debit: '118000.00' },
      { accountCode: '2501', credit: '45000.00' },
    ]);
    expect(plan.totals).toEqual({ debit: 3_80_500_00, credit: 3_80_500_00, customers: 1, vendors: 1 });
    expect(plan.skipped).toEqual([
      { name: 'Profit & Loss A/c', reason: 'profit_and_loss' },
      { name: 'Mystery', reason: 'unknown_group' },
    ]);
  });
});
