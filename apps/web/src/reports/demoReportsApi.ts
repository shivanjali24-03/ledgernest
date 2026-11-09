import { AGING_BUCKETS, agingBucket, compareCodes, csvCell, currencyDigits, daysBetween, formatRate, NORMAL_SIDE, taxRole, toBase, type AgingBucket, type AgingSide } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoAccountsApi } from '../accounts/demoAccountsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { DEMO_BASE_CURRENCY } from '../currencies/demoCurrenciesApi';
import type { Aging, AgingContact, Ledger, ReportsApi, TaxSummary, TrialBalance } from './types';

/** Reports in demo mode, computed from the demo's posted journal entries with the same rules as the API. */
export function createDemoReportsApi(canExport: () => boolean): ReportsApi {
  const accounts = createDemoAccountsApi(() => true);
  const journals = createDemoJournalsApi(() => true);

  const postedLines = async () => {
    const { items } = await journals.list({ status: 'posted', page: 1, pageSize: 1000 });
    const entries = await Promise.all(items.map((e) => journals.get(e.id)));
    return entries.flatMap((e) => e.lines.map((l) => ({ ...l, entryId: e.id, number: e.number, date: e.date, memo: e.memo, reference: e.reference, source: l.taxSourceLine ? e.lines.find((s) => s.lineNo === l.taxSourceLine) : undefined })));
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
    let foreignBalance = mine.filter((l) => l.date < from).reduce((s, l) => s + sign(l.foreignDebit, l.foreignCredit), 0);
    const openingForeign = foreignBalance;
    const rows = mine
      .filter((l) => l.date >= from && l.date <= to)
      .map((l) => {
        balance += sign(l.debit, l.credit);
        foreignBalance += sign(l.foreignDebit, l.foreignCredit);
        const row = { lineId: l.id, entryId: l.entryId, number: l.number, date: l.date, memo: l.memo, reference: l.reference, description: l.description, debit: l.debit, credit: l.credit, balance };
        return a.currency ? { ...row, foreignDebit: l.foreignDebit, foreignCredit: l.foreignCredit, rate: l.rate, foreignBalance } : row;
      });
    return {
      account: { id: a.id, code: a.code, name: a.name, type: a.type, normalSide: NORMAL_SIDE[a.type] },
      from,
      to,
      openingBalance,
      rows,
      totals: { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) },
      closingBalance: balance,
      ...(a.currency && { foreign: { currency: a.currency, openingBalance: openingForeign, closingBalance: foreignBalance } }),
    };
  };

  /** The same figures as the API: each taxed line counts on the side its account is on (sales out, purchases in). */
  const taxSummary = async (from: string, to: string): Promise<TaxSummary> => {
    const lines = (await postedLines()).filter((l) => l.date >= from && l.date <= to);
    const tax = demoTaxState();
    const groupIds = [...new Set(lines.map((l) => l.taxGroup?.id).filter((x): x is string => !!x))];
    const groups = groupIds
      .map((id) => {
        const g = tax.groups.find((x) => x.id === id)!;
        const totalPpm = g.rateIds.reduce((s, rid) => s + (tax.rates.find((r) => r.id === rid)?.ratePpm ?? 0), 0);
        const sum = (role: 'input' | 'output') => {
          const src = lines.filter((l) => l.taxGroup?.id === id && taxRole(l.account.type) === role);
          const sign = role === 'output' ? 1 : -1;
          const taxable = src.reduce((s, l) => s + sign * (l.credit - l.debit), 0);
          const taxAmount = lines.filter((t) => t.taxRate && src.some((l) => l.entryId === t.entryId && l.lineNo === t.taxSourceLine)).reduce((s, t) => s + sign * (t.credit - t.debit), 0);
          return { taxable, tax: taxAmount };
        };
        return { id, name: g.name, supply: g.supply, totalPpm, total: formatRate(totalPpm), outward: sum('output'), inward: sum('input') };
      })
      .sort((a, b) => a.totalPpm - b.totalPpm || a.name.localeCompare(b.name));
    const rateIds = [...new Set(lines.map((l) => l.taxRate?.id).filter((x): x is string => !!x))];
    const rates = rateIds
      .map((id) => {
        const r = tax.rates.find((x) => x.id === id)!;
        const mine = lines.filter((l) => l.taxRate?.id === id);
        const output = mine.filter((l) => taxRole(l.source?.account.type ?? 'income') === 'output').reduce((s, l) => s + l.credit - l.debit, 0);
        const input = mine.filter((l) => taxRole(l.source?.account.type ?? 'income') === 'input').reduce((s, l) => s + l.debit - l.credit, 0);
        return { id, name: r.name, kind: r.kind, rate: formatRate(r.ratePpm), ratePpm: r.ratePpm, output, input, net: output - input };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.ratePpm - b.ratePpm);
    return {
      from,
      to,
      groups,
      rates,
      totals: {
        outwardTaxable: groups.reduce((s, g) => s + g.outward.taxable, 0),
        inwardTaxable: groups.reduce((s, g) => s + g.inward.taxable, 0),
        output: rates.reduce((s, r) => s + r.output, 0),
        input: rates.reduce((s, r) => s + r.input, 0),
        net: rates.reduce((s, r) => s + r.net, 0),
      },
    };
  };

  /** Open invoices or bills on a day, less what was paid by then (loaded on demand: they need contacts and journals too) */
  const aging = async (side: AgingSide, asOf: string): Promise<Aging> => {
    const receivables = side === 'receivables';
    const docs = receivables
      ? (await (await import('../invoices/demoInvoicesApi')).demoInvoiceViews()).filter((i) => i.status === 'issued').map((i) => ({ ...i, date: i.issueDate, vendorReference: null }))
      : (await import('../bills/demoBillsApi')).demoStoredBillViews().filter((b) => b.status === 'open').map((b) => ({ ...b, date: b.billDate }));
    const { createDemoPaymentsApi } = await import('../payments/demoPaymentsApi');
    const payments = (await createDemoPaymentsApi(() => true).list({ kind: receivables ? 'receipt' : 'payment', page: 1, pageSize: 1000 })).items.filter((p) => p.status === 'posted' && p.date <= asOf);
    const zero = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
    const inBase = (minor: number, currency: string | null, rate: string | null) => (currency && rate ? toBase(minor, rate, currencyDigits(currency), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
    const rows = new Map<string, AgingContact>();
    const rowFor = (contact: { id: string; name: string }, currency: string | null) => {
      const key = `${contact.id}:${currency ?? ''}`;
      if (!rows.has(key)) rows.set(key, { contact: { id: contact.id, name: contact.name }, currency, buckets: zero(), total: 0, advance: 0, baseTotal: 0, baseAdvance: 0, documents: [] });
      return rows.get(key)!;
    };
    const totals = { buckets: zero(), total: 0, advance: 0 };
    for (const d of docs) {
      if (d.date > asOf || !d.number) continue;
      const credited = 'credits' in d ? d.credits.filter((c) => c.date <= asOf).reduce((s, c) => s + c.amount, 0) : 0;
      const outstanding = d.total - credited - d.payments.filter((p) => p.date <= asOf).reduce((s, p) => s + p.amount, 0);
      if (outstanding <= 0) continue;
      const bucket = agingBucket(d.dueDate, asOf);
      const r = rowFor(d.contact, d.currency);
      const base = inBase(outstanding, d.currency, d.rate);
      r.buckets[bucket] += outstanding;
      r.total += outstanding;
      r.baseTotal += base;
      totals.buckets[bucket] += base;
      totals.total += base;
      r.documents.push({ id: d.id, number: d.number, vendorReference: d.vendorReference, date: d.date, dueDate: d.dueDate, daysOverdue: Math.max(0, daysBetween(d.dueDate, asOf)), bucket, total: d.total, outstanding });
    }
    for (const p of payments.filter((x) => x.unallocated > 0)) {
      const r = rowFor(p.contact, p.currency);
      const base = inBase(p.unallocated, p.currency, p.rate);
      r.advance += p.unallocated;
      r.baseAdvance += base;
      totals.advance += base;
    }
    if (receivables) {
      const { demoCreditNoteRows } = await import('../credit-notes/demoCreditNotesApi');
      for (const n of demoCreditNoteRows().filter((x) => x.status === 'issued' && x.date <= asOf)) {
        const left = n.total - n.applications.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amount, 0);
        if (left <= 0) continue;
        const r = rowFor(n.contact, n.currency);
        const base = inBase(left, n.currency, n.rate);
        r.advance += left;
        r.baseAdvance += base;
        totals.advance += base;
      }
    }
    const contacts = [...rows.values()].sort((x, y) => x.contact.name.localeCompare(y.contact.name));
    for (const c of contacts) c.documents.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    return { side, asOf, baseCurrency: DEMO_BASE_CURRENCY, buckets: AGING_BUCKETS, contacts, totals: { ...totals, net: totals.total - totals.advance } };
  };

  const csv = (rows: unknown[][]) => new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const money = (n: number) => (n / 100).toFixed(2);
  const guard = () => {
    if (!canExport()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['reports.export'] });
  };
  return {
    trialBalance,
    ledger,
    taxSummary,
    aging,
    async exportAging(side, asOf) {
      guard();
      const a = await aging(side, asOf);
      const fmt = (minor: number, currency: string) => (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
      const rows: unknown[][] = [['contact', 'document', 'date', 'due_date', 'days_overdue', 'currency', 'current', '1_30', '31_60', '61_90', 'over_90', 'advance', 'net']];
      for (const c of a.contacts) {
        const cur = c.currency ?? a.baseCurrency;
        for (const d of c.documents) rows.push([c.contact.name, d.number, d.date, d.dueDate, d.daysOverdue, cur, ...AGING_BUCKETS.map((b) => (b === d.bucket ? fmt(d.outstanding, cur) : '')), '', fmt(d.outstanding, cur)]);
        rows.push([`${c.contact.name} total`, '', '', '', '', cur, ...AGING_BUCKETS.map((b) => fmt(c.buckets[b], cur)), fmt(c.advance, cur), fmt(c.total - c.advance, cur)]);
      }
      rows.push([`Total (${a.baseCurrency})`, '', '', '', '', a.baseCurrency, ...AGING_BUCKETS.map((b) => fmt(a.totals.buckets[b], a.baseCurrency)), fmt(a.totals.advance, a.baseCurrency), fmt(a.totals.net, a.baseCurrency)]);
      return { filename: `${side}-aging-${asOf}.csv`, blob: csv(rows) };
    },
    async exportTaxSummary(from, to) {
      guard();
      const t = await taxSummary(from, to);
      return {
        filename: `tax-summary-${from}-${to}.csv`,
        blob: csv([
          ['tax_group', 'rate', 'outward_taxable_value', 'output_tax', 'inward_taxable_value', 'input_tax'],
          ...t.groups.map((g) => [g.name, g.total, money(g.outward.taxable), money(g.outward.tax), money(g.inward.taxable), money(g.inward.tax)]),
          [],
          ['tax', 'rate', 'output_tax', 'input_tax', 'net_payable'],
          ...t.rates.map((r) => [r.name, r.rate, money(r.output), money(r.input), money(r.net)]),
        ]),
      };
    },
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
