import type { AccountCreateInput, AccountSubtype, AccountType, AccountUpdateInput, Industry, TemplateAccountView } from '@ledgernest/shared';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  description: string | null;
  parentId: string | null;
  systemKey: string | null;
  normalSide: 'debit' | 'credit';
  system: boolean;
  archived: boolean;
  archivedAt: string | null;
  childCount: number;
}

/** An organisation's chart of accounts. Live and demo both implement it. */
export interface AccountsApi {
  list(includeArchived: boolean): Promise<Account[]>;
  create(input: AccountCreateInput): Promise<Account>;
  update(id: string, input: AccountUpdateInput): Promise<Account>;
  archive(id: string): Promise<Account>;
  restore(id: string): Promise<Account>;
  remove(id: string): Promise<void>;
  previewTemplate(industry: Industry): Promise<TemplateAccountView[]>;
  applyTemplate(industry: Industry): Promise<{ industry: Industry; created: number }>;
}
