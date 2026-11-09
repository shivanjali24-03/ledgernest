import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_GROUPS, auditQuerySchema, csvCell } from './index.js';

describe('csvCell', () => {
  it('quotes and escapes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
  });
});

describe('auditQuerySchema', () => {
  it('accepts known groups and ISO dates, rejects the rest', () => {
    expect(auditQuerySchema.parse({ group: 'members', from: '2026-11-01T00:00:00+05:30' }).limit).toBe(50);
    expect(auditQuerySchema.safeParse({ group: 'nope' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '1 Nov' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  it('every group has at least one prefix', () => {
    for (const prefixes of Object.values(AUDIT_ACTION_GROUPS)) expect(prefixes.length).toBeGreaterThan(0);
  });
});
