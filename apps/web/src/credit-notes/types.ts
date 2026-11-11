import type { CreditApplyInput, CreditNoteInput, CreditRefundInput } from '@ledgernest/shared';

export type CreditApplication =
  | { id: string; kind: 'invoice'; date: string; amount: number; invoice: { id: string; number: string | null } }
  | { id: string; kind: 'refund'; date: string; amount: number; rate: string | null; reference: string | null; bankAccount: { id: string; code: string; name: string } | null; journalEntry: { id: string; number: string | null } | null };

export interface CreditNote {
  id: string;
  number: string;
  status: 'issued' | 'void';
  date: string;
  contact: { id: string; name: string };
  invoice: { id: string; number: string | null };
  /** The invoice's currency; null = the base currency */
  currency: string | null;
  rate: string | null;
  reason: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  /** Applied to invoices or refunded */
  applied: number;
  /** Credit still to apply or refund */
  remaining: number;
  taxBreakdown: { name: string; amount: number }[];
  journalEntry: { id: string; number: string | null };
  voidEntry: { id: string; number: string | null } | null;
  lines: { id: string; lineNo: number; invoiceLineId: string; description: string; quantity: string; unitPrice: number; discount: number; amount: number; taxAmount: number; account: { id: string; code: string; name: string } | null; taxGroup: { id: string; name: string } | null }[];
  applications: CreditApplication[];
}

/** Credit notes. Live and demo both implement it. */
export interface CreditNotesApi {
  list(q: { contactId?: string; invoiceId?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: CreditNote[] }>;
  get(id: string): Promise<CreditNote>;
  /** The credit note as a PDF for the customer */
  pdf(id: string): Promise<{ blob: Blob; filename: string }>;
  /** Emails it as a PDF; the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string }>;
  /** How much of each of an invoice's lines can still be credited */
  creditable(invoiceId: string): Promise<{ invoiceLineId: string; quantity: string }[]>;
  create(input: CreditNoteInput): Promise<CreditNote>;
  apply(id: string, input: CreditApplyInput): Promise<CreditNote>;
  refund(id: string, input: CreditRefundInput): Promise<CreditNote>;
  void(id: string, reason?: string): Promise<CreditNote>;
}
