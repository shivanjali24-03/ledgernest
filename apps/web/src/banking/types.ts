import type { ReceiptSuggestion } from '@ledgernest/shared';
import type { BankMoneyInput, BankTransactionKind, BankTransferInput, StatementImportInput, StatementIssue, StatementLine, StatementLineStatus, StatementMapping } from '@ledgernest/shared';
import type { Ledger } from '../reports/types';

export interface BankAccount {
  id: string;
  code: string;
  name: string;
  subtype: 'bank' | 'cash';
  /** null = the base currency */
  currency: string | null;
  archived: boolean;
  /** A parent heading over sub-accounts: its own balance is usually nil */
  hasChildren: boolean;
  /** In the base currency */
  balance: number;
  /** In the account's own currency, for a foreign one */
  foreignBalance: number | null;
  lastActivity: string | null;
  recentMovements: number;
}

export interface BankTransaction {
  id: string;
  kind: BankTransactionKind;
  status: 'posted' | 'void';
  date: string;
  reference: string | null;
  description: string | null;
  bankAccount: { id: string; code: string; name: string; currency: string | null };
  toAccount: { id: string; code: string; name: string; currency: string | null } | null;
  contact: { id: string; name: string } | null;
  currency: string | null;
  amount: number;
  toCurrency: string | null;
  toAmount: number | null;
  rate: string | null;
  taxInclusive: boolean;
  lines: { accountId: string; amount: number; taxGroupId: string | null; description: string | null }[];
  journalEntry: { id: string; number: string | null };
  voidEntry: { id: string; number: string | null } | null;
}

export interface StatementPreview {
  format: 'csv' | 'ofx';
  mapping: StatementMapping | null;
  headers: string[];
  currency: string | null;
  total: number;
  duplicates: number;
  moneyIn: number;
  moneyOut: number;
  firstDate: string | null;
  lastDate: string | null;
  lines: (StatementLine & { duplicate: boolean })[];
  issues: StatementIssue[];
}
export interface StatementImport {
  id: string;
  fileName: string;
  format: 'csv' | 'ofx';
  added: number;
  duplicates: number;
  rejected: number;
  firstDate: string | null;
  lastDate: string | null;
  createdAt: string;
  /** Lines already reconciled (the import can't be undone while there are any) */
  reconciled: number;
}
export interface BankStatementLine {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  status: StatementLineStatus;
  importId: string;
}

export interface BookLine {
  id: string;
  entryId: string;
  number: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  description: string | null;
  /** In the account's currency: in positive */
  amount: number;
}
export interface ReconcileWorkspace {
  account: { id: string; code: string; name: string; currency: string | null };
  date: string;
  bankLines: { id: string; date: string; description: string; reference: string | null; amount: number; balance: number | null }[];
  bookLines: BookLine[];
  suggestions: { statementLineId: string; journalLineIds: string[]; confidence: 'high' | 'medium' }[];
  /** For lines the books don't have: the account (and tax) used last time for a line like it */
  hints?: { statementLineId: string; accountId: string; taxGroupId: string | null; account: { code: string; name: string } }[];
  /** Money in that most likely pays an open invoice: by its number in a UPI note (high), or its balance and the customer's name (medium) */
  receipts?: ReceiptSuggestion[];
  matched: { id: string; date: string; description: string; reference: string | null; amount: number; bookLines: BookLine[] }[];
  ignored: { id: string; date: string; description: string; reference: string | null; amount: number }[];
  summary: { bookBalance: number; outstandingIn: number; outstandingOut: number; cleared: number; since: string | null; unmatchedToDate: number; statementBalance: number | null };
  lastReconciliation: { id: string; statementDate: string; statementBalance: number; createdAt: string } | null;
}
export interface Reconciliation {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number;
  bookBalance: number;
  outstandingIn: number;
  outstandingOut: number;
  matches: number;
  createdAt: string;
}

/** Banking. Live and demo both implement it. */
export interface BankingApi {
  accounts(): Promise<BankAccount[]>;
  activity(accountId: string, from: string, to: string): Promise<Ledger>;
  transactions(q: { bankAccountId?: string; kind?: BankTransactionKind; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: BankTransaction[] }>;
  money(input: BankMoneyInput): Promise<BankTransaction>;
  transfer(input: BankTransferInput): Promise<BankTransaction>;
  void(id: string, reason?: string): Promise<BankTransaction>;
  previewStatement(input: StatementImportInput): Promise<StatementPreview>;
  importStatement(input: StatementImportInput): Promise<{ id: string; added: number; duplicates: number; rejected: number }>;
  statementImports(bankAccountId: string): Promise<StatementImport[]>;
  statementLines(q: { bankAccountId: string; status?: StatementLineStatus; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: BankStatementLine[] }>;
  undoImport(id: string): Promise<void>;
  reconcileWorkspace(accountId: string, date: string): Promise<ReconcileWorkspace>;
  match(statementLineId: string, journalLineIds: string[]): Promise<void>;
  unmatch(statementLineId: string): Promise<void>;
  ignore(statementLineId: string, ignored: boolean): Promise<void>;
  createFromLine(input: { statementLineId: string; accountId: string; taxGroupId: string | null; description: string | null }): Promise<BankTransaction>;
  /** Records a bank line as the customer's receipt against an invoice, already matched */
  receiveFromLine(statementLineId: string, invoiceId: string): Promise<{ number: string }>;
  reconcile(input: { bankAccountId: string; statementDate: string; statementBalance: number }): Promise<Reconciliation>;
  reconciliations(bankAccountId: string): Promise<Reconciliation[]>;
  undoReconciliation(id: string): Promise<void>;
}
