import type { BillDraftInput, BillState, BillStatus } from '@ledgernest/shared';
import type { InvoiceLine } from '../invoices/types';

export type BillLine = InvoiceLine;

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
  /** The vendor's own number for it */
  vendorReference: string | null;
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
