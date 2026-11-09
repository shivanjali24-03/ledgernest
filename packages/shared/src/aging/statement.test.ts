import { describe, expect, it } from 'vitest';
import { buildStatement, statementRows, type AccountStatementEvent } from './statement.js';

const ev = (date: string, kind: AccountStatementEvent['kind'], amount: number, number: string, extra: Partial<AccountStatementEvent> = {}): AccountStatementEvent => ({ date, kind, amount, number, documentId: number, reference: null, currency: 'INR', ...extra });

describe('buildStatement', () => {
  const events = [
    ev('2026-09-10', 'invoice', 10_000, 'INV/1'),
    ev('2026-09-20', 'receipt', -4_000, 'RCT/1'),
    ev('2026-10-05', 'invoice', 5_000, 'INV/2'),
    ev('2026-10-05', 'receipt', -6_000, 'RCT/2'),
    ev('2026-10-12', 'credit_note', -1_000, 'CN/1'),
    ev('2026-10-20', 'void', 6_000, 'RCT/2', { voided: 'receipt' }),
    ev('2026-11-02', 'invoice', 9_999, 'INV/3'),
    ev('2026-10-08', 'invoice', 2_500, 'INV/9', { currency: 'USD' }),
  ];

  it('brings the balance forward, runs it, and carries it down', () => {
    const [inr, usd] = buildStatement(events, '2026-10-01', '2026-10-31', 'INR');
    expect(inr).toMatchObject({ currency: 'INR', opening: 6_000, debits: 11_000, credits: 7_000, closing: 10_000 });
    expect(inr!.lines.map((l) => [l.number, l.debit, l.credit, l.balance])).toEqual([
      ['INV/2', 5_000, 0, 11_000],
      ['RCT/2', 0, 6_000, 5_000],
      ['CN/1', 0, 1_000, 4_000],
      ['RCT/2', 6_000, 0, 10_000],
    ]);
    expect(usd).toMatchObject({ currency: 'USD', opening: 0, closing: 2_500 });
  });

  it('leaves out currencies with nothing to show', () => {
    expect(buildStatement(events, '2026-11-01', '2026-11-30', 'INR').map((s) => s.currency)).toEqual(['INR', 'USD']);
    expect(buildStatement([ev('2026-10-01', 'invoice', 0, 'X', { currency: 'EUR' })], '2026-11-01', '2026-11-30', 'INR')).toEqual([]);
  });

  it('writes rows with voids named for what they voided', () => {
    const sections = buildStatement(events, '2026-10-01', '2026-10-31', 'INR');
    const rows = statementRows({ contact: { id: 'c', name: 'Acme', email: null }, side: 'receivables', from: '2026-10-01', to: '2026-10-31', sections });
    expect(rows[0]).toEqual(['Date', 'Type', 'Document number', 'Reference', 'Currency', 'Debit', 'Credit', 'Balance']);
    expect(rows[1]).toEqual(['2026-10-01', 'Balance brought forward', '', '', 'INR', '', '', '60.00']);
    expect(rows[5]).toEqual(['2026-10-20', 'Receipt voided', 'RCT/2', '', 'INR', '60.00', '', '100.00']);
    expect(rows[6]).toEqual(['2026-10-31', 'Balance carried down', '', '', 'INR', '110.00', '70.00', '100.00']);
  });
});
