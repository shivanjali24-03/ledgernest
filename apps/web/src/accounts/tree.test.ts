import type { Account } from './types';
import { flattenTree, heightOf, levelOf, parentChoices, searchAccounts, suggestCode } from './tree';

const acc = (id: string, code: string, name: string, parentId: string | null = null, type: Account['type'] = 'asset', archived = false): Account => ({
  id, code, name, type, subtype: 'bank', description: null, parentId, systemKey: null, normalSide: 'debit', system: false, archived, archivedAt: null, childCount: 0, currency: null,
});
const accounts = [
  acc('bank', '1100', 'Bank accounts'),
  acc('hdfc', '1100.10', 'HDFC current', 'bank'),
  acc('sbi', '1100.2', 'SBI savings', 'bank'),
  acc('pune', '1100.2.1', 'SBI Pune', 'sbi'),
  acc('cash', '200', 'Petty cash'),
  acc('sales', '4000', 'Sales', null, 'income'),
];

describe('account tree', () => {
  it('orders parents before children and siblings by code', () => {
    expect(flattenTree(accounts).map((r) => [r.account.code, r.depth])).toEqual([
      ['200', 0], ['1100', 0], ['1100.2', 1], ['1100.2.1', 2], ['1100.10', 1], ['4000', 0],
    ]);
    expect(flattenTree(accounts, new Set(['bank'])).map((r) => r.account.code)).toEqual(['200', '1100', '4000']);
  });

  it('keeps ancestors of search matches, by code prefix or name', () => {
    expect(searchAccounts(accounts, 'pune').map((a) => a.id).sort()).toEqual(['bank', 'pune', 'sbi']);
    expect(searchAccounts(accounts, '1100.1').map((a) => a.id)).toEqual(['bank', 'hdfc']);
    expect(searchAccounts(accounts, '  ')).toHaveLength(accounts.length);
  });

  it('offers only parents of the same type that leave room, never the account itself or its sub-accounts', () => {
    expect(levelOf(accounts, 'pune')).toBe(3);
    expect(heightOf(accounts, 'bank')).toBe(3);
    expect(parentChoices(accounts, 'asset').map((a) => a.id)).toEqual(['cash', 'bank', 'sbi', 'pune', 'hdfc']);
    // SBI (height 2) can go under level-1 or level-2 accounts, but not under itself, its sub-account or Pune
    expect(parentChoices(accounts, 'asset', accounts[2]).map((a) => a.id)).toEqual(['cash', 'bank', 'hdfc']);
    expect(parentChoices(accounts, 'income').map((a) => a.id)).toEqual(['sales']);
  });

  it('suggests the next free code', () => {
    expect(suggestCode(accounts, 'asset', accounts[0])).toBe('1100.01');
    expect(suggestCode(accounts, 'income')).toBe('4010');
    expect(suggestCode(accounts, 'expense')).toBe('5000');
  });
});
