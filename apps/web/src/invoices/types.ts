import type { Einvoice, EinvoiceIrnInput, EinvoiceProblem, EwayTransport } from '@ledgernest/shared';
import type { InvoiceDraftInput, InvoiceState, InvoiceStatus, ReminderPolicy } from '@ledgernest/shared';

export interface InvoiceLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice: number;
  /** Percentage */
  discount: number;
  amount: number;
  taxAmount: number;
  item: { id: string; name: string; hsnSac: string | null; unit: string | null; trackBatches?: boolean; trackSerials?: boolean } | null;
  account: { id: string; code: string; name: string } | null;
  taxGroup: { id: string; name: string; supply: 'intra' | 'inter' | null } | null;
  /** The cost centre or project the line belongs to */
  costCentre?: { id: string; code: string; name: string } | null;
  /** A draft invoice line's chosen batch (goods kept in batches); null = earliest expiry first */
  batchId?: string | null;
  /** The batches an issued invoice line's goods came from */
  batches?: { batchNo: string; mfgDate: string | null; expiryDate: string | null; quantity: string }[];
  /** The serial numbers of the units (goods with serial numbers) */
  serials?: string[];
  /** A bill line's batch, as it came in */
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  state: InvoiceState;
  issueDate: string;
  dueDate: string;
  currency: string | null;
  rate: string | null;
  placeOfSupply: string | null;
  /** The number series it's (to be) numbered from */
  seriesId?: string | null;
  reference: string | null;
  notes: string | null;
  contact: { id: string; name: string; legalName: string | null; taxId: string | null; email: string | null; phone?: string | null; billingAddress: Record<string, string | null>; shippingAddress: Record<string, string | null> | null; stateCode: string | null };
  receivableAccount: { id: string; code: string; name: string } | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  taxBreakdown: { name: string; amount: number }[];
  journalEntry: { id: string; number: string | null } | null;
  voidEntry: { id: string; number: string | null } | null;
  /** Receipts that paid it */
  payments: { id: string; number: string; date: string; amount: number }[];
  /** Credit that came off it, from its own credit notes or others */
  credits: { id: string; number: string; date: string; amount: number }[];
  /** The schedule that raised it */
  recurring?: { id: string; name: string } | null;
  /** Credit notes raised against it */
  creditNotes: { id: string; number: string; status: 'issued' | 'void'; total: number }[];
  /** When a payment reminder last went to the customer, and how many have */
  lastRemindedAt: string | null;
  reminders: number;
  /** The customer's link (opened without signing in), how often it was opened and when last */
  share?: InvoiceShare | null;
  /** The e-invoice registration from the portal (printed on the invoice with its signed QR code) */
  irn?: { irn: string; ackNo: string | null; ackDate: string | null } | null;
  lines: InvoiceLine[];
}

export interface InvoiceShare {
  token: string;
  views: number;
  lastViewedAt: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  state: InvoiceState;
  contact: { id: string; name: string };
  issueDate: string;
  dueDate: string;
  currency: string | null;
  total: number;
  amountPaid: number;
  balance: number;
  reference: string | null;
}

export type InvoiceFilter = InvoiceState | 'unpaid';

/** Sales invoices. Live and demo both implement it. */
export interface InvoicesApi {
  list(q: { state?: InvoiceFilter; contactId?: string; search?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; summary: { outstanding: number; overdue: number }; items: InvoiceSummary[] }>;
  get(id: string): Promise<Invoice>;
  /** An issued invoice as a PDF file */
  pdf(id: string): Promise<{ blob: Blob; filename: string }>;
  /** The list as CSV, with the same filters (every page) */
  exportList(q: { state?: InvoiceFilter; contactId?: string; search?: string }): Promise<{ blob: Blob; filename: string }>;
  create(input: InvoiceDraftInput): Promise<Invoice>;
  update(id: string, input: InvoiceDraftInput): Promise<Invoice>;
  remove(id: string): Promise<void>;
  issue(id: string): Promise<Invoice>;
  void(id: string, input: { date?: string; reason?: string }): Promise<Invoice>;
  /** Emails the customer a payment reminder; the demo only pretends */
  remind(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string; lastRemindedAt: string; reminders: number }>;
  /** A reminder for each of a customer's overdue invoices; the demo only pretends */
  remindOverdue(contactId: string): Promise<{ sentTo: string; sent: number; failed: { id: string; reason: string }[] }>;
  /** Emails an issued invoice as a PDF; the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string }>;
  /** The customer's link for an issued invoice: made the first time, the same after that */
  share(id: string): Promise<InvoiceShare>;
  /** Turns the link off; sharing again makes a new one */
  unshare(id: string): Promise<void>;
  /** An issued invoice as GST e-invoice JSON; refused with the problems when the portal would refuse it */
  einvoice(id: string): Promise<{ blob: Blob; filename: string }>;
  /** Every issued B2B invoice in the dates as e-invoice JSON, and those needing a fix */
  einvoices(from: string, to: string): Promise<EinvoiceBatch>;
  /** An issued invoice's goods as e-way bill JSON for the portal; refused with the problems when the portal would refuse it */
  ewayBill(id: string, transport: EwayTransport): Promise<{ blob: Blob; filename: string }>;
  /** Records the IRN the e-invoice portal gave, or takes it off */
  setIrn(id: string, input: EinvoiceIrnInput): Promise<Invoice>;
  clearIrn(id: string): Promise<Invoice>;
  /** Automatic reminders for overdue invoices */
  reminderPolicy(): Promise<ReminderPolicy>;
  setReminderPolicy(policy: ReminderPolicy): Promise<ReminderPolicy>;
}

export interface EinvoiceBatch {
  from: string;
  to: string;
  invoices: Einvoice[];
  skipped: { id: string; number: string; problems: EinvoiceProblem[] }[];
}
