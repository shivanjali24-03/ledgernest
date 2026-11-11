import type { ChallanDispatchInput, InvoiceCopy, QuoteDraftInput, QuoteState, QuoteStatus, QuoteKind, ChallanPurpose } from '@ledgernest/shared';

export interface QuoteLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice: number;
  /** Percentage */
  discount: number;
  amount: number;
  taxAmount: number;
  item: { id: string; name: string; trackStock?: boolean; trackSerials?: boolean } | null;
  account: { id: string; code: string; name: string } | null;
  taxGroup: { id: string; name: string } | null;
  costCentre: { id: string; code: string; name: string } | null;
}

export interface Quote {
  id: string;
  /** A quotation, proforma invoice or sales order */
  kind?: QuoteKind;
  /** A delivery challan's reason (Rule 55) */
  purpose?: ChallanPurpose | null;
  number: string;
  status: QuoteStatus;
  state: QuoteState;
  quoteDate: string;
  expiryDate: string;
  currency: string | null;
  placeOfSupply: string | null;
  /** The warehouse its goods leave or come into (null: the main one) */
  warehouse?: { id: string; name: string } | null;
  /** The GSTIN it's under (null: the organisation's own) */
  gstRegistration?: { id: string; gstin: string; tradeName: string | null } | null;
  reference: string | null;
  notes: string | null;
  contact: { id: string; name: string; email: string | null };
  subtotal: number;
  taxTotal: number;
  total: number;
  /** The invoice it became */
  invoice: { id: string; number: string | null; status: string } | null;
  sentAt: string | null;
  /** A delivery challan's goods: when they left stock, and when they came back (invoiced or returned); job work is due back within a year */
  goods?: { dispatchedAt: string | null; backAt: string | null; backReason: 'invoiced' | 'returned' | null; jobWorkDue: string | null } | null;
  decidedAt: string | null;
  /** Who accepted or declined it from the customer's link, and what they said */
  decidedBy?: string | null;
  decisionNote?: string | null;
  /** The customer's link, and how often it was opened */
  share?: { token: string; views: number; lastViewedAt: string | null } | null;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
}
export type QuoteSummary = Omit<Quote, 'lines'>;
export type QuoteFilter = QuoteState | 'open';

/** Quotes for customers. Live and demo both implement it. */
export interface QuotesApi {
  list(q: { kind?: QuoteKind; state?: QuoteFilter; contactId?: string; search?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: QuoteSummary[] }>;
  get(id: string): Promise<Quote>;
  /** The quote as a PDF file; a delivery challan in one of its three copies */
  pdf(id: string, copy?: InvoiceCopy): Promise<{ blob: Blob; filename: string }>;
  /** A delivery challan's goods leave stock (still ours, sent on challan) */
  dispatch(id: string, input: ChallanDispatchInput): Promise<Quote>;
  /** A delivery challan's goods came back into stock */
  goodsBack(id: string, input: { date?: string }): Promise<Quote>;
  create(input: QuoteDraftInput): Promise<Quote>;
  update(id: string, input: QuoteDraftInput): Promise<Quote>;
  remove(id: string): Promise<void>;
  move(id: string, status: 'draft' | 'sent' | 'accepted' | 'declined'): Promise<Quote>;
  /** A draft invoice with the quote's lines */
  convert(id: string, input: { issueDate?: string }): Promise<{ quote: Quote; invoiceId: string }>;
  /** A new draft of another kind with the same lines (quote → sales order or proforma) */
  copy(id: string, kind: QuoteKind): Promise<Quote>;
  /** Emails it as a PDF (a draft becomes sent); the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string; quote: Quote }>;
  /** The customer's link to accept or decline (a draft becomes sent); the same until turned off */
  share(id: string): Promise<Quote>;
  unshare(id: string): Promise<Quote>;
}
