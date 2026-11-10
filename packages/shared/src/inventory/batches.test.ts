import { describe, expect, it } from 'vitest';
import { allocateBatches, batchExpired, batchFieldsSchema, batchLabel, daysToExpiry } from './batches.js';

const b = (id: string, onHand: bigint, expiryDate: string | null, receivedAt = '2026-01-01') => ({ id, batchNo: id, onHand, expiryDate, receivedAt });

describe('Batches', () => {
  it('sells the earliest-expiring batch first, never an expired one, and says what’s short', () => {
    const stock = [b('LATE', 10_0000n, '2027-06-30'), b('OLD', 5_0000n, '2026-06-30'), b('SOON', 3_0000n, '2026-12-31'), b('NONE', 50_0000n, null), b('GONE', 9_0000n, '2026-10-01')];
    expect(allocateBatches(stock, 5_0000n, '2026-11-10')).toEqual({ take: [{ id: 'SOON', quantity: 3_0000n }, { id: 'LATE', quantity: 2_0000n }], short: 0n });
    expect(allocateBatches(stock.filter((x) => x.id !== 'NONE'), 20_0000n, '2026-11-10')).toEqual({ take: [{ id: 'SOON', quantity: 3_0000n }, { id: 'LATE', quantity: 10_0000n }], short: 7_0000n });
    // Without an expiry date, last; a tie goes to the batch received first
    expect(allocateBatches([b('B', 1_0000n, null, '2026-02-01'), b('A', 1_0000n, null, '2026-01-01')], 1_5000n, '2026-11-10').take).toEqual([{ id: 'A', quantity: 1_0000n }, { id: 'B', quantity: 5000n }]);
  });

  it('counts goods as good through their expiry date', () => {
    expect(batchExpired('2026-11-10', '2026-11-10')).toBe(false);
    expect(batchExpired('2026-11-09', '2026-11-10')).toBe(true);
    expect(batchExpired(null, '2030-01-01')).toBe(false);
    expect(daysToExpiry('2026-12-10', '2026-11-10')).toBe(30);
    expect(daysToExpiry('2026-11-01', '2026-11-10')).toBe(-9);
  });

  it('checks a batch’s dates and writes it for the invoice', () => {
    expect(batchFieldsSchema.safeParse({ batchNo: 'B1', mfgDate: '2026-05-01', expiryDate: '2026-04-01' }).success).toBe(false);
    expect(batchFieldsSchema.parse({ batchNo: ' AB-12 ', mfgDate: '', expiryDate: '2027-03-31' })).toEqual({ batchNo: 'AB-12', mfgDate: null, expiryDate: '2027-03-31' });
    expect(batchLabel({ batchNo: 'AB-12', mfgDate: '2026-01-15', expiryDate: '2027-03-31' })).toBe('Batch AB-12 · Mfg 01/2026 · Exp 03/2027');
  });
});
