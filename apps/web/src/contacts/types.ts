import type { ContactAddress, ContactCreateInput, ContactUpdateInput } from '@ledgernest/shared';

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
  notes: string | null;
  archived: boolean;
  createdAt: string;
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
  get(id: string): Promise<Contact>;
  create(input: ContactCreateInput): Promise<Contact>;
  update(id: string, input: ContactUpdateInput): Promise<Contact>;
  archive(id: string, archive: boolean): Promise<Contact>;
  remove(id: string): Promise<void>;
}
