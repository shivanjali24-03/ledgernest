import type { DocumentIssueRow } from '@ledgernest/shared';
import type { CashForecast as SharedCashForecast, ComplianceItem, Gstr2bResult } from '@ledgernest/shared';
import type { AccountStatement, AccountType, SalesReportBy, SalesReportRow, SalesReportSide, StatementEmailInput, AgingBucket, AgingSide, BsSection, PnlCompare, PnlSection } from '@ledgernest/shared';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  normalSide: 'debit' | 'credit';
  archived: boolean;
  debit: number;
  credit: number;
  balanceDebit: number;
  balanceCredit: number;
}
export interface TrialBalance {
  asOf: string;
  rows: TrialBalanceRow[];
  totals: { debit: number; credit: number; balanceDebit: number; balanceCredit: number };
  balanced: boolean;
}
export interface LedgerRow {
  lineId: string;
  entryId: string;
  number: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
  /** Foreign-currency accounts only */
  foreignDebit?: number;
  foreignCredit?: number;
  rate?: string | null;
  foreignBalance?: number;
}
export interface Ledger {
  account: { id: string; code: string; name: string; type: AccountType; normalSide: 'debit' | 'credit' };
  from: string;
  to: string;
  openingBalance: number;
  rows: LedgerRow[];
  totals: { debit: number; credit: number };
  closingBalance: number;
  /** For a foreign-currency account: its balances in that currency */
  foreign?: { currency: string; openingBalance: number; closingBalance: number };
}

export interface TaxSummary {
  from: string;
  to: string;
  /** Taxable value and tax per group, for sales (outward) and purchases (inward) */
  groups: { id: string; name: string; supply: 'intra' | 'inter' | null; totalPpm: number; total: string; outward: { taxable: number; tax: number }; inward: { taxable: number; tax: number } }[];
  /** Tax charged (output), tax claimable (input) and the difference, per rate */
  rates: { id: string; name: string; kind: string; rate: string; ratePpm: number; output: number; input: number; net: number }[];
  totals: { outwardTaxable: number; inwardTaxable: number; output: number; input: number; net: number };
}

export interface AgingDocument {
  id: string;
  number: string;
  vendorReference: string | null;
  date: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
  total: number;
  outstanding: number;
  /** Interest on late payment accrued to the day, under the invoice's terms */
  interest?: number;
}
export interface AgingContact {
  contact: { id: string; name: string };
  /** null = the base currency */
  currency: string | null;
  buckets: Record<AgingBucket, number>;
  total: number;
  /** Received (or paid) and not yet applied */
  advance: number;
  baseTotal: number;
  baseAdvance: number;
  documents: AgingDocument[];
  /** The documents' interest on late payment, together */
  interest?: number;
}
/** Who owes what, or what's owed, on a day, by days past due */
export interface Aging {
  side: AgingSide;
  asOf: string;
  baseCurrency: string;
  buckets: readonly AgingBucket[];
  contacts: AgingContact[];
  /** In the base currency */
  totals: { buckets: Record<AgingBucket, number>; total: number; advance: number; net: number };
}

export interface StatementRow {
  accountId: string;
  code: string;
  name: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  /** One per column; a parent's include its sub-accounts' */
  amounts: number[];
}
export interface ProfitAndLoss {
  from: string;
  to: string;
  compare: PnlCompare;
  /** By cost centre, each column is one (null: the untagged lines) */
  columns: { from: string; to: string; costCentre?: { id: string; code: string; name: string } | null }[];
  /** Set when the report is for one cost centre ("none": the untagged lines) */
  costCentre?: { id: string; code: string; name: string } | 'none' | null;
  sections: { section: PnlSection; rows: StatementRow[]; total: number[] }[];
  grossProfit: number[];
  operatingProfit: number[];
  netProfit: number[];
}
export interface BalanceSheet {
  asOf: string;
  compareAsOf: string | null;
  columns: string[];
  sections: { section: BsSection; rows: StatementRow[]; total: number[] }[];
  profitThisYear: number[];
  profitEarlierYears: number[];
  yearStart: string[];
  totalAssets: number[];
  totalLiabilities: number[];
  totalEquity: number[];
  balanced: boolean[];
}

export interface DashboardKpi {
  value: number;
  /** At the end of last month */
  previous: number;
  trend: number[];
}
export interface Dashboard {
  asOf: string;
  baseCurrency: string;
  kpis: { cash: DashboardKpi; receivables: DashboardKpi; payables: DashboardKpi; profit: DashboardKpi & { since: string } };
  monthly: { month: string; income: number; expenses: number; profit: number; cash: number }[];
  alerts: { kind: 'overdue_invoices' | 'overdue_bills' | 'unreconciled' | 'recurring_due' | 'open_periods' | 'draft_entries' | 'approvals_waiting' | 'low_stock' | 'quotes_expiring' | 'recurring_bills_due' | 'bills_due_soon' | 'msme_due' | 'stock_expiring'; count: number; amount?: number }[];
  /** gst and upi only for organisations in India */
  setup: { organisation: boolean; team: boolean; coa: boolean; fiscal: boolean; bank: boolean; gst?: boolean; upi?: boolean };
}

export interface CashFlowRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}
export interface CashFlow {
  from: string;
  to: string;
  openingCash: number;
  closingCash: number;
  netChange: number;
  indirect: { netProfit: number; depreciation: number; workingCapital: CashFlowRow[]; operating: number; investingRows: CashFlowRow[]; investing: number; financingRows: CashFlowRow[]; financing: number; total: number };
  direct: { customers: number; otherReceipts: number; vendors: number; staff: number; taxes: number; otherPayments: number; investing: number; financing: number; operating: number; total: number };
}

export type GstHeads = { igst: number; cgst: number; sgst: number; cess: number };
export type GstRateRow = { rate: number; taxable: number } & GstHeads;
export interface Gstr3b {
  from: string;
  to: string;
  gstin: string | null;
  outward: { taxable: number } & GstHeads;
  outwardUntaxed: number;
  itc: GstHeads;
  inwardTaxable: number;
  setOff: { cash: GstHeads; carriedForward: GstHeads; used: Record<'igst' | 'cgst' | 'sgst' | 'cess', GstHeads> };
  payable: GstHeads;
  carriedForward: GstHeads;
}
export interface Gstr1 {
  from: string;
  to: string;
  gstin: string | null;
  legalName: string;
  b2b: { gstin: string; name: string; number: string; date: string; value: number; placeOfSupply: string | null; items: GstRateRow[] }[];
  b2cl: { number: string; date: string; value: number; placeOfSupply: string | null; items: GstRateRow[] }[];
  b2cs: ({ placeOfSupply: string | null; type: 'intra' | 'inter' } & GstRateRow)[];
  exports: { number: string; date: string; value: number; currency: string | null; items: GstRateRow[] }[];
  cdnr: { gstin: string; name: string; number: string; date: string; invoice: string | null; value: number; items: GstRateRow[] }[];
  cdnur: { name: string; number: string; date: string; invoice: string | null; value: number; items: GstRateRow[] }[];
  hsn: ({ hsn: string; unit: string | null; quantity: string; returned: boolean } & GstRateRow)[];
  documents: { invoices: { first: string | null; last: string | null; total: number; cancelled: number }; creditNotes: { total: number; cancelled: number } };
  /** GSTR-1 Table 13: documents issued, series by series */
  docIssue?: DocumentIssueRow[];
}

/** Reports. Live and demo both implement it. */
export interface ReportsApi {
  trialBalance(asOf: string): Promise<TrialBalance>;
  ledger(accountId: string, from: string, to: string): Promise<Ledger>;
  exportTrialBalance(asOf: string): Promise<{ blob: Blob; filename: string }>;
  exportLedger(accountId: string, from: string, to: string): Promise<{ blob: Blob; filename: string }>;
  taxSummary(from: string, to: string): Promise<TaxSummary>;
  exportTaxSummary(from: string, to: string): Promise<{ blob: Blob; filename: string }>;
  aging(side: AgingSide, asOf: string): Promise<Aging>;
  exportAging(side: AgingSide, asOf: string): Promise<{ blob: Blob; filename: string }>;
  /** Sales or purchases by customer, vendor or item, in the base currency */
  sales(side: SalesReportSide, by: SalesReportBy, from: string, to: string): Promise<SalesReport>;
  exportSales(side: SalesReportSide, by: SalesReportBy, from: string, to: string): Promise<{ blob: Blob; filename: string }>;
  /** A contact's statement of account over some days */
  statement(contactId: string, side: AgingSide, from: string, to: string): Promise<AccountStatement & { baseCurrency: string }>;
  exportStatement(contactId: string, side: AgingSide, from: string, to: string, format: 'csv' | 'pdf'): Promise<{ blob: Blob; filename: string }>;
  /** Emails it as a PDF; the demo only pretends */
  emailStatement(input: StatementEmailInput): Promise<{ sentTo: string }>;
  /** costCentreId: one cost centre, or "none" for the untagged lines */
  profitAndLoss(from: string, to: string, compare: PnlCompare, costCentreId?: string): Promise<ProfitAndLoss>;
  exportProfitAndLoss(from: string, to: string, compare: PnlCompare, costCentreId?: string): Promise<{ blob: Blob; filename: string }>;
  balanceSheet(asOf: string, compareAsOf: string | null): Promise<BalanceSheet>;
  exportBalanceSheet(asOf: string, compareAsOf: string | null): Promise<{ blob: Blob; filename: string }>;
  dashboard(): Promise<Dashboard>;
  cashFlow(from: string, to: string): Promise<CashFlow>;
  gstr3b(from: string, to: string): Promise<Gstr3b>;
  gstr1(from: string, to: string): Promise<Gstr1>;
  /** GSTR-2B (the portal's JSON) matched to bills dated in the range */
  gstr2b(content: string, from: string, to: string): Promise<Gstr2bReport>;
  /** What would go wrong when filing GST, with examples to fix */
  gstHealth(): Promise<GstHealth>;
  /** Cash week by week for the coming weeks */
  cashForecast(weeks: number): Promise<CashForecast>;
  /** Statutory due dates coming up (India) */
  compliance(): Promise<Compliance>;
  /** TDS kept back from vendor payments in the dates */
  tds(from: string, to: string, side?: 'payable' | 'receivable'): Promise<TdsReport>;
  /** Bills from micro and small suppliers against the 45-day rule, and what section 43B(h) takes out of the year */
  msme(date?: string): Promise<MsmeReportView>;
  /** Balance confirmations asked for the day and side, with their answers */
  confirmations(asOf: string, side: 'receivable' | 'payable'): Promise<ConfirmationRow[]>;
  /** Asks everyone on that side with a balance on the day (or just those given) to confirm it, by email where possible */
  requestConfirmations(input: { asOf: string; side: 'receivable' | 'payable'; contactIds?: string[]; send: boolean }): Promise<{ created: number; emailed: number; skipped: { contactId: string; name: string; reason: string }[] }>;
  /** The books as Tally Prime XML: ledger masters, or the vouchers posted in the dates */
  tally(part: 'masters' | 'vouchers', from?: string, to?: string): Promise<{ blob: Blob; filename: string }>;
  exportGstr1(from: string, to: string, format: 'csv' | 'json'): Promise<{ blob: Blob; filename: string }>;
  exportCashFlow(from: string, to: string): Promise<{ blob: Blob; filename: string }>;
}

export interface SalesReport {
  side: SalesReportSide;
  by: SalesReportBy;
  from: string;
  to: string;
  baseCurrency: string;
  rows: SalesReportRow[];
  totals: { net: number; tax: number; total: number };
}

/** What POST /reports/gst/gstr-2b returns */
export type Gstr2bReport = Gstr2bResult & { gstin: string | null; period: string | null; otherGstin: boolean; from: string; to: string };

/** What GET /reports/cash-forecast returns */
export type CashForecast = SharedCashForecast & { currency: string; lateCustomers: { contact: { id: string; name: string }; days: number }[] };

/** What GET /reports/compliance returns */
export interface Compliance {
  today: string | null;
  /** lateFee and interest: what filing a late GST return today would cost (paise) */
  items: (ComplianceItem & { daysLeft: number; amount?: number; lateFee?: number; interest?: number })[];
}

/** What GET /reports/tds returns */
export interface TdsReport {
  from: string;
  to: string;
  side?: 'payable' | 'receivable';
  total: number;
  sections: { section: string; count: number; base: number; tds: number }[];
  months: { month: string; due: string; count: number; base: number; tds: number }[];
  missingPan: string[];
  payments: { id: string; number: string; date: string; vendor: { id: string; name: string; pan: string | null }; section: string; ratePpm: number; base: number; amount: number; tds: number }[];
}

/** What GET /reports/gst/health returns */
export interface GstHealth {
  checked: boolean;
  issues: { kind: 'org_gstin' | 'org_address' | 'items_hsn' | 'customers_state' | 'customers_einvoice' | 'vendors_gstin'; count: number; sample: { id: string; name: string }[] }[];
}

export type MsmeReportView = Omit<import('@ledgernest/shared').MsmeReport, 'bills'> & { bills: (import('@ledgernest/shared').MsmeBill & { vendorReference: string | null })[] };

export interface ConfirmationRow {
  id: string;
  contact: { id: string; name: string; phone: string | null };
  currency: string;
  balance: number;
  status: 'pending' | 'agreed' | 'disputed';
  theirBalance: number | null;
  note: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  sentTo: string | null;
  views: number;
  token: string;
}
