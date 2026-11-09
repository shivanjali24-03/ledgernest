import type { AttachmentType, JournalDraftInput, Totals } from '@ledgernest/shared';

export interface JournalLine {
  id: string;
  lineNo: number;
  accountId: string;
  account: { code: string; name: string; type: string; currency?: string | null };
  description: string | null;
  debit: number;
  credit: number;
  /** The tax group charged on this line (its amount is then the net value) */
  taxGroup: { id: string; name: string } | null;
  taxInclusive: boolean;
  /** Set on a tax line the system generated */
  taxRate: { id: string; name: string; kind: string; ratePpm: number } | null;
  /** The line a generated tax line was charged on */
  taxSourceLine: number | null;
  /** A line on a foreign-currency account: the amount in that currency and the rate it was converted at */
  currency: string | null;
  foreignDebit: number;
  foreignCredit: number;
  rate: string | null;
  /** Set on an exchange-difference line generated on posting: the line it settles */
  fxSourceLine: number | null;
  /** The cost centre or project the line belongs to */
  costCentre?: { id: string; code: string; name: string } | null;
}

export interface JournalRef {
  id: string;
  number: string | null;
}

export interface JournalEntry {
  id: string;
  number: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  status: 'draft' | 'posted';
  postedAt: string | null;
  createdAt: string;
  createdBy: { name: string; email: string } | null;
  postedBy: { name: string; email: string } | null;
  reversalOf: JournalRef | null;
  reversedBy: JournalRef | null;
  lines: JournalLine[];
  totals: Totals;
  attachments: { id: string; fileName: string; contentType: string; size: number; createdAt: string }[];
}

export interface JournalSummary {
  id: string;
  number: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  status: 'draft' | 'posted';
  lineCount: number;
  totals: Totals;
  reversalOf: JournalRef | null;
  reversed: boolean;
  attachmentCount: number;
}

export interface JournalQuery {
  status?: 'draft' | 'posted';
  search?: string;
  accountId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Journal entries. Live and demo both implement it. */
export interface JournalsApi {
  list(q: JournalQuery): Promise<{ total: number; page: number; pageSize: number; items: JournalSummary[] }>;
  get(id: string): Promise<JournalEntry>;
  create(input: JournalDraftInput): Promise<JournalEntry>;
  update(id: string, input: JournalDraftInput): Promise<JournalEntry>;
  remove(id: string): Promise<void>;
  post(id: string): Promise<JournalEntry>;
  reverse(id: string, input: { date?: string; memo?: string }): Promise<JournalEntry>;
  attach(id: string, file: { fileName: string; type: AttachmentType; data: string }): Promise<JournalEntry>;
  download(id: string, attachmentId: string): Promise<{ blob: Blob; filename: string }>;
  detach(id: string, attachmentId: string): Promise<void>;
}
