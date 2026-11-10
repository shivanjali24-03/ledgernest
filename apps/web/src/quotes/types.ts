import type { QuoteDraftInput, QuoteState, QuoteStatus } from '@ledgernest/shared';

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
  item: { id: string; name: string } | null;
  account: { id: string; code: string; name: string } | null;
  taxGroup: { id: string; name: string } | null;
  costCentre: { id: string; code: string; name: string } | null;
}

export interface Quote {
  id: string;
  number: string;
  status: QuoteStatus;
  state: QuoteState;
  quoteDate: string;
  expiryDate: string;
  currency: string | null;
  placeOfSupply: string | null;
  reference: string | null;
  notes: string | null;
  contact: { id: string; name: string; email: string | null };
  subtotal: number;
  taxTotal: number;
  total: number;
  /** The invoice it became */
  invoice: { id: string; number: string | null; status: string } | null;
  sentAt: string | null;
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
  list(q: { state?: QuoteFilter; contactId?: string; search?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: QuoteSummary[] }>;
  get(id: string): Promise<Quote>;
  /** The quote as a PDF file */
  pdf(id: string): Promise<{ blob: Blob; filename: string }>;
  create(input: QuoteDraftInput): Promise<Quote>;
  update(id: string, input: QuoteDraftInput): Promise<Quote>;
  remove(id: string): Promise<void>;
  move(id: string, status: 'draft' | 'sent' | 'accepted' | 'declined'): Promise<Quote>;
  /** A draft invoice with the quote's lines */
  convert(id: string, input: { issueDate?: string }): Promise<{ quote: Quote; invoiceId: string }>;
  /** Emails it as a PDF (a draft becomes sent); the demo only pretends */
  email(id: string, input: { email?: string; message?: string }): Promise<{ sentTo: string; quote: Quote }>;
  /** The customer's link to accept or decline (a draft becomes sent); the same until turned off */
  share(id: string): Promise<Quote>;
  unshare(id: string): Promise<Quote>;
}
