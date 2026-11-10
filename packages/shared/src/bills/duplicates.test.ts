import { describe, expect, it } from 'vitest';
import { billReferenceKey, possibleDuplicateBills } from './index.js';

describe('Bills entered twice', () => {
  it('sees the same bill number however it was typed', () => {
    expect(['SOS/887', 'sos 887', 'SOS-0887', ' S.O.S 887 '].map(billReferenceKey)).toEqual(['sos887', 'sos887', 'sos887', 'sos887']);
    // Once the separators go, the digits run together; only a leading zero run is dropped
    expect(billReferenceKey('INV/2026-27/0100')).toBe('inv2026270100');
    expect(billReferenceKey('B-007')).toBe('b7');
    expect(billReferenceKey(null)).toBe('');
  });

  it('flags the same number for sure, and the same total within three days when there’s no number', () => {
    const others = [
      { id: 'a', vendorReference: 'sos 887', billDate: '2026-09-01', total: 5_000_00 },
      { id: 'b', vendorReference: 'SOS/888', billDate: '2026-10-05', total: 45_000_00 },
      { id: 'c', vendorReference: null, billDate: '2026-10-07', total: 45_000_00 },
      { id: 'd', vendorReference: null, billDate: '2026-10-20', total: 45_000_00 },
    ];
    expect(possibleDuplicateBills({ id: 'x', vendorReference: 'SOS/0887', billDate: '2026-10-05', total: 45_000_00 }, others).map((o) => [o.id, o.reason])).toEqual([
      ['a', 'reference'],
      ['c', 'amount'],
    ]);
    // Without a number: amount and date only
    expect(possibleDuplicateBills({ id: 'x', vendorReference: null, billDate: '2026-10-06', total: 45_000_00 }, others).map((o) => o.id)).toEqual(['b', 'c']);
    // Itself never counts
    expect(possibleDuplicateBills(others[0]!, others)).toEqual([]);
  });
});
