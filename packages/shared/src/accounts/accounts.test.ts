import { describe, expect, it } from 'vitest';
import { accountCreateSchema, accountUpdateSchema, compareCodes, NORMAL_SIDE, subtypeBelongsTo, systemAccountName } from './index.js';

describe('accounts', () => {
  it('knows which side increases each type', () => {
    expect(NORMAL_SIDE.asset).toBe('debit');
    expect(NORMAL_SIDE.income).toBe('credit');
  });

  it('validates new accounts, tidying the code', () => {
    const r = accountCreateSchema.safeParse({ code: ' 1100.a ', name: ' HDFC current account ', type: 'asset', subtype: 'bank' });
    expect(r.success && r.data).toEqual({ code: '1100.A', name: 'HDFC current account', type: 'asset', subtype: 'bank', parentId: null, description: null });
    expect(accountCreateSchema.safeParse({ code: '1100', name: 'X', type: 'asset', subtype: 'payroll' }).success).toBe(false);
    expect(accountCreateSchema.safeParse({ code: '.100', name: 'X', type: 'asset', subtype: 'bank' }).success).toBe(false);
    expect(accountCreateSchema.safeParse({ code: '1100', name: '', type: 'asset', subtype: 'bank' }).success).toBe(false);
    expect(accountCreateSchema.safeParse({ code: '1100', name: 'X', type: 'cash', subtype: 'bank' }).success).toBe(false);
  });

  it('accepts partial updates but not empty ones', () => {
    expect(accountUpdateSchema.safeParse({ name: 'Petty cash' }).success).toBe(true);
    expect(accountUpdateSchema.safeParse({}).success).toBe(false);
    expect(subtypeBelongsTo('expense', 'payroll')).toBe(true);
    expect(subtypeBelongsTo('income', 'payroll')).toBe(false);
  });

  it('sorts codes numerically and names system accounts in the organisation language', () => {
    expect(['1101', '1100.01', '200', '1100', '10'].sort(compareCodes)).toEqual(['10', '200', '1100', '1100.01', '1101']);
    expect(systemAccountName('retained_earnings', 'hi-IN')).toBe('प्रतिधारित आय');
    expect(systemAccountName('retained_earnings', 'ja-JP')).toBe('Retained earnings');
  });
});
