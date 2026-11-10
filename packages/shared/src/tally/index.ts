/**
 * The books as Tally Prime XML, for accountants who keep their clients in Tally: ledgers under Tally's own groups
 * (Sundry Debtors, Duties & Taxes, Sales Accounts…), then each posted entry as a voucher of the type Tally would
 * use for it. Import the masters first (Gateway of Tally → Import → Masters), then the vouchers (Import →
 * Transactions).
 */

export interface TallyLedger {
  name: string;
  /** A Tally group, e.g. "Sundry Debtors" */
  parent: string;
  gstin?: string | null;
}

export type TallyVoucherType = 'Sales' | 'Purchase' | 'Receipt' | 'Payment' | 'Contra' | 'Journal' | 'Credit Note' | 'Debit Note';

export interface TallyVoucher {
  type: TallyVoucherType;
  /** yyyy-mm-dd */
  date: string;
  number: string;
  narration?: string | null;
  /** Paise; each line is a debit or a credit */
  lines: { ledger: string; debit: number; credit: number }[];
}

/** Tally's predefined groups for each kind of account */
export function tallyGroup(type: string, subtype: string, opts: { taxAccount?: boolean } = {}): string {
  if (opts.taxAccount) return 'Duties & Taxes';
  const groups: Record<string, string> = {
    'asset/bank': 'Bank Accounts',
    'asset/cash': 'Cash-in-Hand',
    'asset/accounts_receivable': 'Sundry Debtors',
    'asset/inventory': 'Stock-in-Hand',
    'asset/current_asset': 'Current Assets',
    'asset/fixed_asset': 'Fixed Assets',
    'asset/other_asset': 'Current Assets',
    'liability/accounts_payable': 'Sundry Creditors',
    'liability/tax_payable': 'Duties & Taxes',
    'liability/credit_card': 'Current Liabilities',
    'liability/current_liability': 'Current Liabilities',
    'liability/long_term_liability': 'Loans (Liability)',
    'liability/other_liability': 'Current Liabilities',
    'equity/owner_equity': 'Capital Account',
    'equity/retained_earnings': 'Reserves & Surplus',
    'equity/other_equity': 'Capital Account',
    'income/operating_income': 'Sales Accounts',
    'income/other_income': 'Indirect Incomes',
    'expense/cost_of_sales': 'Purchase Accounts',
    'expense/operating_expense': 'Indirect Expenses',
    'expense/payroll': 'Indirect Expenses',
    'expense/depreciation': 'Indirect Expenses',
    'expense/other_expense': 'Indirect Expenses',
  };
  return groups[`${type}/${subtype}`] ?? (type === 'income' ? 'Indirect Incomes' : type === 'expense' ? 'Indirect Expenses' : type === 'liability' ? 'Current Liabilities' : type === 'equity' ? 'Capital Account' : 'Current Assets');
}

/**
 * The voucher type for an entry: Contra between banks, Receipt or Payment when money moves through a bank, otherwise
 * what the entry came from (an invoice is a sale, a bill a purchase), or a Journal.
 */
export function tallyVoucherType(lines: { bank: boolean; debit: number; credit: number }[], source: 'invoice' | 'bill' | 'credit_note' | 'debit_note' | 'payment' | null): TallyVoucherType {
  const bank = lines.filter((l) => l.bank);
  if (bank.length && bank.length === lines.length) return 'Contra';
  if (bank.length) return bank.reduce((s, l) => s + l.debit - l.credit, 0) >= 0 ? 'Receipt' : 'Payment';
  if (source === 'invoice') return 'Sales';
  if (source === 'bill') return 'Purchase';
  if (source === 'credit_note') return 'Credit Note';
  if (source === 'debit_note') return 'Debit Note';
  return 'Journal';
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const rupees = (paise: number) => (paise / 100).toFixed(2);
const envelope = (report: 'All Masters' | 'Vouchers', company: string, messages: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    ' <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    `   <REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>`,
    '   <REQUESTDATA>',
    ...messages.map((m) => `    <TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`),
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');

/** The ledger masters */
export function tallyMastersXml(company: string, ledgers: TallyLedger[]): string {
  return envelope(
    'All Masters',
    company,
    ledgers.map((l) => `<LEDGER NAME="${xml(l.name)}" ACTION="Create"><NAME.LIST><NAME>${xml(l.name)}</NAME></NAME.LIST><PARENT>${xml(l.parent)}</PARENT>${l.gstin ? `<PARTYGSTIN>${xml(l.gstin)}</PARTYGSTIN>` : ''}<ISBILLWISEON>No</ISBILLWISEON></LEDGER>`),
  );
}

/** The vouchers: in Tally a debit is "deemed positive" with a negative amount, a credit the other way round */
export function tallyVouchersXml(company: string, vouchers: TallyVoucher[]): string {
  return envelope(
    'Vouchers',
    company,
    vouchers.map((v) => {
      const d = v.date.replace(/-/g, '');
      const lines = v.lines
        .filter((l) => l.debit || l.credit)
        .map((l) => {
          const debit = l.debit - l.credit > 0;
          const amount = Math.abs(l.debit - l.credit);
          return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? '-' : ''}${rupees(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        })
        .join('');
      return `<VOUCHER VCHTYPE="${xml(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${d}</DATE><EFFECTIVEDATE>${d}</EFFECTIVEDATE><VOUCHERTYPENAME>${xml(v.type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(v.number)}</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${v.narration ? `<NARRATION>${xml(v.narration)}</NARRATION>` : ''}${lines}</VOUCHER>`;
    }),
  );
}

/** Ledger names Tally can tell apart: an account and a contact (or two accounts) with one name get a suffix */
export function uniqueLedgerNames<T extends { key: string; name: string; suffix: string }>(items: T[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const i of items) seen.set(i.name.trim().toLowerCase(), (seen.get(i.name.trim().toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const i of items) {
    const base = i.name.trim();
    let name = (seen.get(base.toLowerCase()) ?? 0) > 1 ? `${base} (${i.suffix})` : base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${i.suffix} ${n})`;
    used.add(name.toLowerCase());
    out.set(i.key, name);
  }
  return out;
}
