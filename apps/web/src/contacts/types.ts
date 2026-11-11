import type { ContactAddress, ContactCreateInput, ContactUpdateInput, MsmeCategory, GstTreatment } from '@ledgernest/shared';

export interface Contact {
  id: string;
  name: string;
  isCustomer: boolean;
  isVendor: boolean;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: ContactAddress;
  /** null = same as billing */
  shippingAddress: ContactAddress | null;
  /** GST state code of the place of supply; null outside India */
  stateCode: string | null;
  /** null = the base currency */
  currency: string | null;
  paymentTermsDays: number;
  /** The most a customer may owe, in their currency's smallest unit; null = no limit */
  creditLimit?: number | null;
  /** Interest on late payment, basis points a year: null = the organisation's, 0 = none */
  interestRateBp?: number | null;
  /** The vendor's MSME category from its Udyam certificate: micro and small must be paid within 45 days */
  msmeCategory?: MsmeCategory | null;
  /** How GST treats them; null = from the GSTIN and country */
  gstTreatment?: GstTreatment | null;
  udyamNumber?: string | null;
  /** The customer's account link (opened without signing in), how often it was opened and when last */
  share?: { token: string; views: number; lastViewedAt: string | null } | null;
  /** When we last chased this customer for what's overdue */
  lastChasedAt?: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  /** What a customer owes in their currency: unpaid invoices less advances (negative = in credit) */
  receivable?: number;
  /** What we owe a vendor in their currency: unpaid bills less advances (negative = paid ahead) */
  payable?: number;
}

export interface ContactQuery {
  search?: string;
  type?: 'customer' | 'vendor';
  archived?: boolean;
  page: number;
  pageSize: number;
}

/** Customers and vendors. Live and demo both implement it. */
export interface ContactsApi {
  list(q: ContactQuery): Promise<{ total: number; page: number; pageSize: number; items: Contact[] }>;
  /** As CSV, in the columns the contacts import reads */
  exportList(q: Omit<ContactQuery, 'page' | 'pageSize'>): Promise<{ blob: Blob; filename: string }>;
  get(id: string): Promise<Contact>;
  create(input: ContactCreateInput): Promise<Contact>;
  update(id: string, input: ContactUpdateInput): Promise<Contact>;
  archive(id: string, archive: boolean): Promise<Contact>;
  remove(id: string): Promise<void>;
  /** A customer's account link: made the first time, the same after that */
  share(id: string): Promise<{ token: string; views: number; lastViewedAt: string | null }>;
  /** Turns the link off; sharing again makes a new one */
  unshare(id: string): Promise<void>;
  /** Notes that the customer was chased for what's overdue (on WhatsApp or by phone) */
  chased(id: string, channel: 'whatsapp' | 'phone'): Promise<{ lastChasedAt: string }>;
}
