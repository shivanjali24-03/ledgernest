import type { Invoice } from '../invoices/types';

/** What a schedule copies from an invoice: its customer, lines, reference, notes and place of supply */
export const templateOf = (i: Invoice) => ({
  contact: { id: i.contact.id, name: i.contact.name },
  reference: i.reference,
  notes: i.notes,
  placeOfSupply: i.placeOfSupply,
  lines: i.lines.map((l) => ({ itemId: l.item?.id ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxGroupId: l.taxGroup?.id ?? null, accountId: l.account?.id ?? null })),
});
export type RecurringTemplate = ReturnType<typeof templateOf>;
