import { compareCodes, csvCell, NORMAL_SIDE } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoAccountsApi } from '../accounts/demoAccountsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import type { Ledger, ReportsApi, TrialBalance } from './types';

/** Reports in demo mode, computed from the demo's posted journal entries with the same rules as the API. */
export function createDemoReportsApi(canExport: () => boolean): ReportsApi {
  const accounts = createDemoAccountsApi(() => true);
  const journals = createDemoJournalsApi(() => true);

  const postedLines = async () => {
    const { items } = await journals.list({ status: 'posted', page: 1, pageSize: 1000 });
    const entries = await Promise.all(items.map((e) => journals.get(e.id)));
    return entries.flatMap((e) => e.lines.map((l) => ({ ...l, entryId: e.id, number: e.number, date: e.date, memo: e.memo, reference: e.reference })));
  };

  const trialBalance = async (asOf: string): Promise<TrialBalance> => {
    const [accs, lines] = await Promise.all([accounts.list(true), postedLines()]);
    const rows = accs
      .map((a) => {
        const mine = lines.filter((l) => l.accountId === a.id && l.date <= asOf);
        const debit = mine.reduce((s, l) => s + l.debit, 0);
        const credit = mine.reduce((s, l) => s + l.credit, 0);
        const net = debit - credit;
        return { accountId: a.id, code: a.code, name: a.name, type: a.type, normalSide: NORMAL_SIDE[a.type], archived: a.archived, debit, credit, balanceDebit: Math.max(net, 0), balanceCredit: Math.max(-net, 0) };
      })
      .filter((r) => r.debit || r.credit || !r.archived)
      .sort((x, y) => compareCodes(x.code, y.code));
    const totals = rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit, balanceDebit: t.balanceDebit + r.balanceDebit, balanceCredit: t.balanceCredit + r.balanceCredit }), { debit: 0, credit: 0, balanceDebit: 0, balanceCredit: 0 });
    return { asOf, rows, totals, balanced: totals.debit === totals.credit };
  };

  const ledger = async (accountId: string, from: string, to: string): Promise<Ledger> => {
    const a = (await accounts.list(true)).find((x) => x.id === accountId);
    if (!a) throw new ApiError('not_found', 404);
    const sign = (d: number, c: number) => (NORMAL_SIDE[a.type] === 'debit' ? d - c : c - d);
    const mine = (await postedLines()).filter((l) => l.accountId === accountId).sort((x, y) => x.date.localeCompare(y.date) || (x.number ?? '').localeCompare(y.number ?? ''));
    let balance = mine.filter((l) => l.date < from).reduce((s, l) => s + sign(l.debit, l.credit), 0);
    const openingBalance = balance;
    const rows = mine
      .filter((l) => l.date >= from && l.date <= to)
      .map((l) => {
        balance += sign(l.debit, l.credit);
        return { lineId: l.id, entryId: l.entryId, number: l.number, date: l.date, memo: l.memo, reference: l.reference, description: l.description, debit: l.debit, credit: l.credit, balance };
      });
    return {
      account: { id: a.id, code: a.code, name: a.name, type: a.type, normalSide: NORMAL_SIDE[a.type] },
      from,
      to,
      openingBalance,
      rows,
      totals: { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) },
      closingBalance: balance,
    };
  };

  const csv = (rows: unknown[][]) => new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const money = (n: number) => (n / 100).toFixed(2);
  const guard = () => {
    if (!canExport()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['reports.export'] });
  };
  return {
    trialBalance,
    ledger,
    async exportTrialBalance(asOf) {
      guard();
      const tb = await trialBalance(asOf);
      return { filename: `trial-balance-${asOf}.csv`, blob: csv([['code', 'account', 'type', 'debits', 'credits', 'balance_debit', 'balance_credit'], ...tb.rows.map((r) => [r.code, r.name, r.type, money(r.debit), money(r.credit), money(r.balanceDebit), money(r.balanceCredit)])]) };
    },
    async exportLedger(accountId, from, to) {
      guard();
      const l = await ledger(accountId, from, to);
      return { filename: `ledger-${l.account.code}-${from}-${to}.csv`, blob: csv([['date', 'number', 'memo', 'debit', 'credit', 'balance'], ['', '', 'Opening balance', '', '', money(l.openingBalance)], ...l.rows.map((r) => [r.date, r.number, r.memo, money(r.debit), money(r.credit), money(r.balance)])]) };
    },
  };
}
