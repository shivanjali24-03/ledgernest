import { describe, expect, it } from 'vitest';
import { suggestReceipts } from './receipts.js';

const kumar = { id: 'c1', name: 'Kumar Logistics', legalName: 'Kumar Logistics Private Limited' };
const invoices = [
  { id: 'i1', number: 'INV/2026-27/0001', balance: 1_180_00, contact: kumar },
  { id: 'i2', number: 'INV/2026-27/0002', balance: 5_000_00, contact: kumar },
  { id: 'i3', number: 'INV/2026-27/0010', balance: 700_00, contact: { id: 'c2', name: 'Bluewave Clinics' } },
];
const line = (id: string, description: string, amount: number, reference: string | null = null) => ({ id, description, reference, amount });

describe('receipts from bank lines', () => {
  it('finds the invoice by the number a UPI note carries, however the bank writes it', () => {
    expect(suggestReceipts([line('l1', 'UPI/CR/412345678901/KUMAR LOG/okhdfc/Invoice INV/2026-27/0001', 1_180_00)], invoices)).toEqual([
      { statementLineId: 'l1', invoiceId: 'i1', invoiceNumber: 'INV/2026-27/0001', contact: { id: 'c1', name: 'Kumar Logistics' }, balance: 1_180_00, confidence: 'high' },
    ]);
    // Punctuation stripped by the bank, and a part payment: still the invoice
    expect(suggestReceipts([line('l1', 'UPI-INV2026270001-KUMAR', 500_00)], invoices)[0]).toMatchObject({ invoiceId: 'i1', confidence: 'high' });
  });

  it('falls back to the exact balance from a customer named in the narration', () => {
    expect(suggestReceipts([line('l2', 'NEFT CR KUMAR LOGISTICS PVT LTD', 5_000_00)], invoices)[0]).toMatchObject({ invoiceId: 'i2', confidence: 'medium' });
    // The right amount but nobody named, or the name but the wrong amount: nothing
    expect(suggestReceipts([line('l3', 'CASH DEPOSIT', 700_00), line('l4', 'NEFT KUMAR LOGISTICS', 4_999_00)], invoices)).toEqual([]);
  });

  it('gives each invoice to one line, and ignores money going out', () => {
    const two = suggestReceipts([line('a', 'Invoice INV/2026-27/0001', 1_180_00), line('b', 'Invoice INV/2026-27/0001 again', 1_180_00), line('c', 'INV/2026-27/0002 refund', -5_000_00)], invoices);
    expect(two.map((s) => s.statementLineId)).toEqual(['a']);
  });

  it('doesn’t take INV/…/0010 for INV/…/0001', () => {
    const ten = { id: 'i10', number: 'INV/2026-27/0010', balance: 900_00, contact: kumar };
    expect(suggestReceipts([line('x', 'UPI Invoice INV/2026-27/0010', 900_00)], [invoices[0]!, ten])[0]).toMatchObject({ invoiceId: 'i10' });
  });
});
