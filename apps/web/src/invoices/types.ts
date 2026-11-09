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
  item: { id: string; name: string; hsnSac: string | null; unit: string | null } | null;
  account: { id: string; code: string; name: string } | null;
  taxGroup: { id: string; name: string; supply: 'intra' | 'inter' | null } | null;
  /** The cost centre or project the line belongs to */
  costCentre?: { id: string; code: string; name: string } | null;
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
  reference: string | null;
  notes: string | null;
  contact: { id: string; name: string; legalName: string | null; taxId: string | null; email: string | null; billingAddress: Record<string, string | null>; shippingAddress: Record<string, string | null> | null; stateCode: string | null };
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
  lines: InvoiceLine[];
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
  create(input: InvoiceDraftInput): Promise<Invoice>;
  update(id: string, input: InvoiceDraftInput): Promise<Invoice>;
  remove(id: string): Promise<void>;
  issue(id: string): Promise<Invoice>;
  void(id: string, input: { date?: string; reason?: string }): Promise<Invoice>;
  /** Emails the customer a payment reminder; the demo only pretends */
  remind(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string; lastRemindedAt: string; reminders: number }>;
  /** Emails an issued invoice as a PDF; the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string }>;
  /** Automatic reminders for overdue invoices */
  reminderPolicy(): Promise<ReminderPolicy>;
  setReminderPolicy(policy: ReminderPolicy): Promise<ReminderPolicy>;
}
