import type { InvoiceState } from '@ledgernest/shared';

/** What GET /public/invoices/:token returns: an invoice as its customer sees it, without signing in */
export interface PublicInvoice {
  organization: {
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: { line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null };
    terms: string | null;
    hasLogo: boolean;
  };
  invoice: {
    number: string;
    state: InvoiceState;
    issueDate: string;
    dueDate: string;
    currency: string;
    placeOfSupply: string | null;
    reference: string | null;
    customer: { name: string; taxId: string | null };
    lines: { description: string; hsnSac: string | null; quantity: string; unitPrice: number; discount: number; amount: number; taxAmount: number }[];
    subtotal: number;
    taxBreakdown: { name: string; amount: number }[];
    total: number;
    amountPaid: number;
    balance: number;
  };
  upi: { link: string; upiId: string } | null;
}
