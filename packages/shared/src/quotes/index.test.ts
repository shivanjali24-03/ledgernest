import { describe, expect, it } from 'vitest';
import { QUOTE_MOVES, quoteDraftSchema, quoteEditable, quoteNumber, quoteState } from './index.js';

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
