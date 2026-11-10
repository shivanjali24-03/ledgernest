import { docKey } from '../taxes/gstr2b.js';

/** Words in a company name that say nothing about which company it is */
const COMMON = new Set(['private', 'limited', 'india', 'traders', 'enterprises', 'services', 'company', 'pvt', 'ltd', 'llp']);

export interface OpenInvoiceForMatch {
  id: string;
  /** e.g. INV/2026-27/0042 */
  number: string;
  balance: number;
  contact: { id: string; name: string; legalName?: string | null };
}

export interface ReceiptSuggestion {
  statementLineId: string;
  invoiceId: string;
  invoiceNumber: string;
  contact: { id: string; name: string };
  balance: number;
  confidence: 'high' | 'medium';
}

/**
 * Money in, matched to the open invoice it pays. Paid by scanning an invoice's UPI QR code, the bank narration
 * carries the invoice number, however the bank mangles its punctuation (high confidence). Otherwise, the invoice's
 * exact balance from a customer whose name is in the narration (medium). Each invoice goes to one line at most.
 */
export function suggestReceipts(lines: { id: string; description: string; reference: string | null; amount: number }[], invoices: OpenInvoiceForMatch[]): ReceiptSuggestion[] {
  const open = invoices.map((i) => ({
    ...i,
    key: docKey(i.number),
    // As some banks write it: punctuation dropped, digits run together, zeros kept
    raw: i.number.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    names: [...new Set(`${i.contact.name} ${i.contact.legalName ?? ''}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !COMMON.has(w)))],
  }));
  const used = new Set<string>();
  const out: ReceiptSuggestion[] = [];
  for (const l of lines) {
    if (l.amount <= 0) continue;
    const text = `${l.description} ${l.reference ?? ''}`;
    const squashed = docKey(text);
    const raw = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const lower = text.toLowerCase();
    // The whole number: INV/…/0001 isn't the start of INV/…/0010
    const has = (hay: string, needle: string) => new RegExp(`${needle}(?![0-9])`).test(hay);
    const byNumber = open.find((i) => !used.has(i.id) && i.key.length >= 6 && (has(squashed, i.key) || has(raw, i.raw)));
    const byName = !byNumber && open.find((i) => !used.has(i.id) && i.balance === l.amount && i.names.some((w) => lower.includes(w)));
    const hit = byNumber || byName;
    if (!hit) continue;
    used.add(hit.id);
    out.push({ statementLineId: l.id, invoiceId: hit.id, invoiceNumber: hit.number, contact: { id: hit.contact.id, name: hit.contact.name }, balance: hit.balance, confidence: byNumber ? 'high' : 'medium' });
  }
  return out;
}
