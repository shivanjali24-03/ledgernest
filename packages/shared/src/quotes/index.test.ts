import { describe, expect, it } from 'vitest';
import { QUOTE_MOVES, quoteDraftSchema, quoteEditable, quoteNumber, quoteRows, quoteState } from './index.js';

describe('quotes', () => {
  it('shows open quotes past their expiry as expired, and settled ones as they are', () => {
    expect(quoteState({ status: 'sent', expiryDate: '2026-11-30' }, '2026-11-30')).toBe('sent');
    expect(quoteState({ status: 'sent', expiryDate: '2026-11-30' }, '2026-12-01')).toBe('expired');
    expect(quoteState({ status: 'draft', expiryDate: '2026-11-30' }, '2026-12-01')).toBe('expired');
    expect(quoteState({ status: 'accepted', expiryDate: '2026-11-30' }, '2026-12-01')).toBe('accepted');
  });

  it('allows only sensible moves, and edits while open', () => {
    expect(QUOTE_MOVES.invoiced).toEqual([]);
    expect(QUOTE_MOVES.draft).toContain('sent');
    expect(quoteEditable('sent')).toBe(true);
    expect(quoteEditable('accepted')).toBe(false);
  });

  it('checks the dates and lines', () => {
    const base = { contactId: '6f0d2c3e-8a1b-4c5d-9e7f-0a1b2c3d4e5f', quoteDate: '2026-11-10', expiryDate: '2026-12-10', lines: [{ description: 'Design', quantity: '2', unitPrice: 500_000 }] };
    expect(quoteDraftSchema.safeParse(base).success).toBe(true);
    expect(quoteDraftSchema.safeParse({ ...base, expiryDate: '2026-11-09' }).success).toBe(false);
    expect(quoteDraftSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(quoteNumber(7)).toBe('QT-0007');
  });
});

describe('quoteRows', () => {
  it('lays out lines and totals for the PDF', () => {
    const rows = quoteRows({ currency: 'INR', subtotal: 1_000_000, taxTotal: 180_000, total: 1_180_000, lines: [{ description: 'Racking', quantity: '4', unitPrice: 250_000, discount: 10, taxGroup: { name: 'GST 18%' }, amount: 900_000 }] }, 2);
    expect(rows[0]).toEqual(['Description', 'Qty', 'Price (INR)', 'Discount', 'Tax', 'Amount (INR)']);
    expect(rows[1]).toEqual(['Racking', '4', '2500.00', '10%', 'GST 18%', '9000.00']);
    expect(rows.at(-1)).toEqual(['', '', '', '', 'Total', '11800.00']);
  });
});
