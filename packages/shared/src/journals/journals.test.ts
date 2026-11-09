import { describe, expect, it } from 'vitest';
import { journalDraftSchema, journalLineSchema, journalNumber, postingProblem, sniffAttachmentType, toMinor, totals } from './index.js';

const acc = '9b2c6b62-7d1e-4f3a-9a51-2f6c1c0e8a11';

describe('journal entries', () => {
  it('lines are either a debit or a credit, in whole minor units', () => {
    expect(journalLineSchema.safeParse({ accountId: acc, debit: 1000 }).success).toBe(true);
    expect(journalLineSchema.safeParse({ accountId: acc, debit: 1000, credit: 1000 }).success).toBe(false);
    expect(journalLineSchema.safeParse({ accountId: acc }).success).toBe(false);
    expect(journalLineSchema.safeParse({ accountId: acc, debit: 10.5 }).success).toBe(false);
    expect(journalLineSchema.safeParse({ accountId: acc, credit: -5 }).success).toBe(false);
  });

  it('drafts may be unbalanced; posting needs two lines that balance', () => {
    const lines = [{ debit: 50000, credit: 0 }, { debit: 0, credit: 30000 }];
    expect(journalDraftSchema.safeParse({ date: '2026-04-15', lines: lines.map((l) => ({ accountId: acc, ...l })) }).success).toBe(true);
    expect(totals(lines)).toEqual({ debit: 50000, credit: 30000, difference: 20000 });
    expect(postingProblem(lines)).toBe('unbalanced');
    expect(postingProblem([{ debit: 100, credit: 0 }])).toBe('too_few_lines');
    expect(postingProblem([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBeNull();
  });

  it('reads amounts as people type them', () => {
    expect(toMinor('1,23,456.7')).toBe(12345670);
    expect(toMinor('0.05')).toBe(5);
    expect(toMinor('12.345')).toBeNull();
    expect(toMinor('12', 0)).toBe(12);
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('')).toBe(0);
  });

  it('numbers entries per financial year and recognises documents by their bytes', () => {
    expect(journalNumber('FY 2026–27', 7)).toBe('JV/2026-27/0007');
    expect(journalNumber('FY 2026', 12)).toBe('JV/2026/0012');
    expect(sniffAttachmentType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffAttachmentType(new TextEncoder().encode('<html>'))).toBeNull();
  });
});
