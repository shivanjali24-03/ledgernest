import type { AccountType, AgingBucket, AgingSide, BsSection, PnlCompare, PnlSection } from '@ledgernest/shared';

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
  columns: { from: string; to: string }[];
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
  alerts: { kind: 'overdue_invoices' | 'overdue_bills' | 'unreconciled' | 'recurring_due' | 'open_periods' | 'draft_entries'; count: number; amount?: number }[];
  setup: { organisation: boolean; team: boolean; coa: boolean; fiscal: boolean; bank: boolean };
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
  profitAndLoss(from: string, to: string, compare: PnlCompare): Promise<ProfitAndLoss>;
  exportProfitAndLoss(from: string, to: string, compare: PnlCompare): Promise<{ blob: Blob; filename: string }>;
  balanceSheet(asOf: string, compareAsOf: string | null): Promise<BalanceSheet>;
  exportBalanceSheet(asOf: string, compareAsOf: string | null): Promise<{ blob: Blob; filename: string }>;
  dashboard(): Promise<Dashboard>;
}
