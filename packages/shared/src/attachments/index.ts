import type { OrganizationPermission } from '../access/permissions.js';

/**
 * Supporting documents (receipts, PDFs, photos) kept with invoices, bills, payments and bank transactions,
 * as journal entries already can. The same types and 2 MB limit; the bytes are checked, not just the name.
 */
export const ATTACHABLE_DOCUMENTS = ['invoice', 'bill', 'payment', 'bank_transaction'] as const;
export type AttachableDocument = (typeof ATTACHABLE_DOCUMENTS)[number];
export const MAX_ATTACHMENTS_PER_DOCUMENT = 10;

/** Who may see a document's attachments, and who may add or remove them */
export const ATTACHMENT_PERMISSIONS: Record<AttachableDocument, { view: OrganizationPermission; manage: OrganizationPermission }> = {
  invoice: { view: 'invoices.view', manage: 'invoices.manage' },
  bill: { view: 'bills.view', manage: 'bills.manage' },
  payment: { view: 'invoices.view', manage: 'payments.manage' },
  bank_transaction: { view: 'banking.view', manage: 'banking.manage' },
};

/** The audit action prefix each document's attachments are recorded under, so they show with the document */
export const ATTACHMENT_AUDIT_PREFIX: Record<AttachableDocument, string> = { invoice: 'org.invoice', bill: 'org.bill', payment: 'org.payment', bank_transaction: 'org.banking' };
