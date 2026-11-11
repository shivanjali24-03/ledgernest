import type { BillDraftInput, BillOfEntry, BillState, BillStatus, ItcKind } from '@ledgernest/shared';
import type { InvoiceLine } from '../invoices/types';

export type BillLine = InvoiceLine & {
  /** Input tax credit: eligible, blocked (s.17(5)) or ineligible; when not, its GST is cost */
  itc?: ItcKind;
};

export interface Bill {
  id: string;
  number: string | null;
  status: BillStatus;
  state: BillState;
  billDate: string;
  dueDate: string;
  currency: string | null;
  rate: string | null;
  placeOfSupply: string | null;
  /** The warehouse its goods leave or come into (null: the main one) */
  warehouse?: { id: string; name: string } | null;
  /** The GSTIN it's under (null: the organisation's own) */
  gstRegistration?: { id: string; gstin: string; tradeName: string | null } | null;
  /** The vendor's own number for it */
  vendorReference: string | null;
  /** The date on the vendor's bill; null = the bill date */
  vendorBillDate?: string | null;
  /** We pay the GST under reverse charge: how much, and the self-invoice raised for it */
  reverseCharge?: boolean;
  /** Owed from before the books started here (imported): not a purchase of this period */
  opening?: boolean;
  reverseChargeTax?: { name: string; amount: number }[];
  selfInvoiceNumber?: string | null;
  /** Goods imported: the bill of entry; its taxed lines are the assessable value, not owed here */
  billOfEntry?: BillOfEntry | null;
  notes: string | null;
  contact: {
    id: string;
    name: string;
    legalName: string | null;
    taxId: string | null;
    email: string | null;
    billingAddress: Record<string, string | null>;
    shippingAddress: Record<string, string | null> | null;
    stateCode: string | null;
  };
  payableAccount: { id: string; code: string; name: string } | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  taxBreakdown: { name: string; amount: number }[];
  journalEntry: { id: string; number: string | null } | null;
  voidEntry: { id: string; number: string | null } | null;
  /** Payments that settled it */
  payments: { id: string; number: string; date: string; amount: number }[];
  /** Debit notes raised against it */
  debitNotes?: { id: string; number: string; status: 'issued' | 'void'; total: number }[];
  /** Credit from debit notes that came off it */
  credits?: { id: string; number: string; date: string; amount: number }[];
  lines: BillLine[];
}

export interface BillSummary {
  id: string;
  number: string | null;
  status: BillStatus;
  state: BillState;
  contact: { id: string; name: string };
  billDate: string;
  dueDate: string;
  currency: string | null;
  total: number;
  amountPaid: number;
  balance: number;
  vendorReference: string | null;
  vendorBillDate?: string | null;
}

export type BillFilter = BillState | 'unpaid';

/** Purchase bills. Live and demo both implement it. */
export interface BillsApi {
  list(q: { state?: BillFilter; contactId?: string; search?: string; page: number; pageSize: number }): Promise<{
    total: number;
    page: number;
    pageSize: number;
    summary: { outstanding: number; overdue: number };
    items: BillSummary[];
  }>;
  /** The list as CSV, with the same filters (every page) */
  exportList(q: { state?: BillFilter; contactId?: string; search?: string }): Promise<{ blob: Blob; filename: string }>;
  get(id: string): Promise<Bill>;
  create(input: BillDraftInput): Promise<Bill>;
  update(id: string, input: BillDraftInput): Promise<Bill>;
  remove(id: string): Promise<void>;
  /** Refused with duplicate_bill when the vendor's bill number is recorded already, unless allowDuplicate */
  record(id: string, opts?: { allowDuplicate?: boolean }): Promise<Bill>;
  /** Other bills from the same vendor that may be this one entered twice */
  duplicates(id: string): Promise<BillDuplicate[]>;
  void(id: string, input: { date?: string; reason?: string }): Promise<Bill>;
  /** The self-invoice for a purchase under reverse charge from an unregistered supplier */
  selfInvoice(id: string): Promise<{ blob: Blob; filename: string }>;
}

export interface BillDuplicate {
  id: string;
  number: string | null;
  status: string;
  vendorReference: string | null;
  billDate: string;
  total: number;
  reason: 'reference' | 'amount';
}
