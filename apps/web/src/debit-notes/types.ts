import type { VendorCreditApplyInput, VendorCreditInput, VendorCreditRefundInput } from '@ledgernest/shared';

export type DebitNoteApplication =
  | { id: string; kind: 'bill'; date: string; amount: number; bill: { id: string; number: string | null } }
  | { id: string; kind: 'refund'; date: string; amount: number; reference: string | null; bankAccount: { id: string; code: string; name: string } | null; journalEntry: { id: string; number: string | null } | null };

/** A debit note to a vendor: goods sent back or a price cut, against one of their bills */
export interface DebitNote {
  id: string;
  number: string;
  status: 'issued' | 'void';
  date: string;
  contact: { id: string; name: string };
  bill: { id: string; number: string | null; vendorReference: string | null };
  /** The supplier's own credit note number */
  vendorReference: string | null;
  reason: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  applied: number;
  /** Credit still to apply or have refunded */
  remaining: number;
  taxBreakdown: { name: string; amount: number }[];
  journalEntry: { id: string; number: string | null };
  voidEntry: { id: string; number: string | null } | null;
  lines: { id: string; lineNo: number; billLineId: string; description: string; quantity: string; unitPrice: number; discount: number; amount: number; taxAmount: number; account: { id: string; code: string; name: string } | null; taxGroup: { id: string; name: string } | null }[];
  applications: DebitNoteApplication[];
}

/** Debit notes. Live and demo both implement it. */
export interface DebitNotesApi {
  list(q: { contactId?: string; billId?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: DebitNote[] }>;
  get(id: string): Promise<DebitNote>;
  /** The debit note as a PDF for the vendor */
  pdf(id: string): Promise<{ blob: Blob; filename: string }>;
  /** How much of each of a bill's lines can still be credited, and which are goods kept in stock */
  creditable(billId: string): Promise<{ billLineId: string; quantity: string; stock: boolean }[]>;
  create(input: VendorCreditInput): Promise<DebitNote>;
  apply(id: string, input: VendorCreditApplyInput): Promise<DebitNote>;
  refund(id: string, input: VendorCreditRefundInput): Promise<DebitNote>;
  void(id: string, reason?: string): Promise<DebitNote>;
}
