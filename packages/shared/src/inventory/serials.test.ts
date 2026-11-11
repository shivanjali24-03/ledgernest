import { describe, expect, it } from 'vitest';
import { duplicateSerials, imeiValid, parseSerials, serialsProblem } from './serials.js';

describe('Serial numbers', () => {
  it('reads serials typed one per line or separated by commas', () => {
    expect(parseSerials(' SN-1, SN-2\nSN-3 ;SN-4  ')).toEqual(['SN-1', 'SN-2', 'SN-3', 'SN-4']);
    expect(parseSerials('  \n ')).toEqual([]);
  });

  it('needs one serial per whole unit, none twice', () => {
    expect(serialsProblem('2', ['A1', 'B2'])).toBeNull();
    expect(serialsProblem('2.5', ['A1', 'B2'])).toBe('not_whole');
    expect(serialsProblem('3', ['A1', 'B2'])).toBe('count');
    expect(serialsProblem('2', ['A1', 'a1'])).toBe('duplicate');
    expect(duplicateSerials(['X1', 'x1', 'Y'])).toEqual(['x1']);
  });

  it('checks a 15-digit IMEI’s check digit', () => {
    expect(imeiValid('490154203237518')).toBe(true);
    expect(imeiValid('490154203237519')).toBe(false);
    expect(imeiValid('SN-ABC-123')).toBe(true);
  });
});
