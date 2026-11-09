import type { BankMoneyInput, BankTransactionKind, BankTransferInput } from '@ledgernest/shared';
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

/** Banking. Live and demo both implement it. */
export interface BankingApi {
  accounts(): Promise<BankAccount[]>;
  activity(accountId: string, from: string, to: string): Promise<Ledger>;
  transactions(q: { bankAccountId?: string; kind?: BankTransactionKind; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: BankTransaction[] }>;
  money(input: BankMoneyInput): Promise<BankTransaction>;
  transfer(input: BankTransferInput): Promise<BankTransaction>;
  void(id: string, reason?: string): Promise<BankTransaction>;
}
