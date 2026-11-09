import type { PaymentKind, ReceiptInput } from '@ledgernest/shared';

export interface Payment {
  id: string;
  kind: PaymentKind;
  number: string;
  status: 'posted' | 'void';
  date: string;
  contact: { id: string; name: string };
  bankAccount: { id: string; code: string; name: string; currency: string | null };
  /** The documents' currency; null = the base currency */
  currency: string | null;
  rate: string | null;
  amount: number;
  allocated: number;
  unallocated: number;
  reference: string | null;
  notes: string | null;
  journalEntry: { id: string; number: string | null };
  voidEntry: { id: string; number: string | null } | null;
  allocations: { invoiceId: string; invoiceNumber: string | null; amount: number }[];
}

export interface OpenInvoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string | null;
  total: number;
  balance: number;
}

/** Receipts and payments. Live and demo both implement it. */
export interface PaymentsApi {
  list(q: { kind?: PaymentKind; contactId?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: Payment[] }>;
  openInvoices(contactId: string): Promise<OpenInvoice[]>;
  receive(input: ReceiptInput): Promise<Payment>;
  void(id: string, reason?: string): Promise<Payment>;
}
