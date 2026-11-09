import type { AccountType } from '@ledgernest/shared';

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
}
export interface Ledger {
  account: { id: string; code: string; name: string; type: AccountType; normalSide: 'debit' | 'credit' };
  from: string;
  to: string;
  openingBalance: number;
  rows: LedgerRow[];
  totals: { debit: number; credit: number };
  closingBalance: number;
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

/** Reports. Live and demo both implement it. */
export interface ReportsApi {
  trialBalance(asOf: string): Promise<TrialBalance>;
  ledger(accountId: string, from: string, to: string): Promise<Ledger>;
  exportTrialBalance(asOf: string): Promise<{ blob: Blob; filename: string }>;
  exportLedger(accountId: string, from: string, to: string): Promise<{ blob: Blob; filename: string }>;
  taxSummary(from: string, to: string): Promise<TaxSummary>;
  exportTaxSummary(from: string, to: string): Promise<{ blob: Blob; filename: string }>;
}
