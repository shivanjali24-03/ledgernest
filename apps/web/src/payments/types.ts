import type { PaymentKind, ReceiptInput, VendorPaymentInput } from '@ledgernest/shared';

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
  /** Tax deducted at source on a vendor payment: kept back from the bank, owed to the government */
  tds?: { section: string; ratePpm: number; base: number; amount: number; account: { id: string; code: string; name: string } | null } | null;
  /** What actually left (or reached) the bank */
  bankAmount?: number;
  reference: string | null;
  notes: string | null;
  journalEntry: { id: string; number: string | null };
  voidEntry: { id: string; number: string | null } | null;
  /** The invoices a receipt paid, or the bills a payment settled */
  allocations: { kind: 'invoice' | 'bill'; documentId: string; documentNumber: string | null; amount: number }[];
}

/** An invoice or bill with something left to pay */
export interface OpenInvoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string | null;
  total: number;
  balance: number;
  /** Before GST: what TDS is usually worked out on (bills) */
  subtotal?: number;
  /** A bill's number from the vendor */
  vendorReference?: string | null;
}

/** Receipts and payments. Live and demo both implement it. */
export interface PaymentsApi {
  list(q: { kind?: PaymentKind; contactId?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: Payment[] }>;
  openInvoices(contactId: string): Promise<OpenInvoice[]>;
  openBills(contactId: string): Promise<OpenInvoice[]>;
  receive(input: ReceiptInput): Promise<Payment>;
  pay(input: VendorPaymentInput): Promise<Payment>;
  void(id: string, reason?: string): Promise<Payment>;
  /** A receipt as a PDF file */
  pdf(id: string): Promise<{ blob: Blob; filename: string }>;
  /** Emails a posted receipt to the customer as a PDF; the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string }>;
}
