import { B2CL_THRESHOLD, gstSetOff, isGstin, splitTax, todayIn, zeroHeads, AGING_BUCKETS, agingBucket, BS_SECTIONS, bsSectionOf, fiscalYearOf, fiscalYearSpan, PNL_SECTIONS, pnlColumns, pnlSectionOf, type BsSection, type PnlCompare, type PnlSection, compareCodes, csvCell, currencyDigits, daysBetween, formatRate, NORMAL_SIDE, taxRole, toBase, type AgingBucket, type AgingSide } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoPendingApprovals } from '../approvals/demoApprovalsApi';
import { demoCostCentreRows } from '../cost-centres/demoCostCentresApi';
import { createDemoAccountsApi } from '../accounts/demoAccountsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { DEMO_BASE_CURRENCY } from '../currencies/demoCurrenciesApi';
import type { Aging, AgingContact, BalanceSheet, CashFlow, Dashboard, GstHeads, GstRateRow, Gstr1, Gstr3b, Ledger, ProfitAndLoss, ReportsApi, StatementRow, TaxSummary, TrialBalance } from './types';

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

  /** Rows for a statement as the API builds them: parents carry their sub-accounts' totals */
  const statementRows = async <S extends string>(columns: Map<string, number>[], sectionOf: (type: string, subtype: string) => S | null, sign: (type: string) => 1 | -1) => {
    const accs = await accounts.list(true);
    const byId = new Map(accs.map((a) => [a.id, a]));
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) out.push(p);
      return out;
    };
    const amounts = new Map<string, number[]>();
    for (const a of accs) {
      if (!sectionOf(a.type, a.subtype)) continue;
      columns.forEach((col, k) => {
        const v = (col.get(a.id) ?? 0) * sign(a.type);
        if (!v) return;
        for (const id of [a.id, ...ancestors(a.id)]) {
          const arr = amounts.get(id) ?? columns.map(() => 0);
          arr[k]! += v;
          amounts.set(id, arr);
        }
      });
    }
    return accs
      .filter((a) => sectionOf(a.type, a.subtype) && amounts.get(a.id)?.some((v) => v !== 0))
      .sort((x, y) => compareCodes(x.code, y.code))
      .map((a) => ({ section: sectionOf(a.type, a.subtype)!, accountId: a.id, code: a.code, name: a.name, depth: ancestors(a.id).length, parentId: a.parentId, hasChildren: a.childCount > 0, amounts: amounts.get(a.id)! }));
  };
  /** costCentre: undefined for every line, "none" for the untagged ones, or one cost centre's id */
  const sums = async (from: string | null, to: string, given?: Awaited<ReturnType<typeof postedLines>>, costCentre?: string) => {
    const out = new Map<string, number>();
    for (const l of given ?? (await postedLines()))
      if (l.date <= to && (!from || l.date >= from) && (costCentre === undefined || (l.costCentre?.id ?? 'none') === costCentre)) out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.debit - l.credit);
    return out;
  };
  const profitAndLoss = async (from: string, to: string, compare: PnlCompare, costCentreId?: string): Promise<ProfitAndLoss> => {
    // One read of the books for every column
    const posted = await postedLines();
    const accs = new Map((await accounts.list(true)).map((a) => [a.id, a.type]));
    const used = new Map<string, { id: string; code: string; name: string }>();
    if (compare === 'costCentres') for (const l of posted) if (l.costCentre && l.date >= from && l.date <= to && ['income', 'expense'].includes(accs.get(l.accountId) ?? '')) used.set(l.costCentre.id, l.costCentre);
    const columns: ProfitAndLoss['columns'] = compare === 'costCentres' ? [...[...used.values()].sort((x, y) => x.code.localeCompare(y.code)).map((c) => ({ from, to, costCentre: c })), { from, to, costCentre: null }] : pnlColumns(from, to, compare);
    const filter = costCentreId && costCentreId !== 'none' ? demoCostCentreRows().find((c) => c.id === costCentreId) : undefined;
    if (costCentreId && costCentreId !== 'none' && !filter) throw new ApiError('not_found', 404);
    const rows = await statementRows<PnlSection>(await Promise.all(columns.map((c) => sums(c.from, c.to, posted, c.costCentre !== undefined ? (c.costCentre?.id ?? 'none') : costCentreId))), pnlSectionOf, (type) => (type === 'income' ? -1 : 1));
    const total = (sec: PnlSection) => columns.map((_c, k) => rows.filter((r) => r.section === sec && r.depth === 0).reduce((s, r) => s + r.amounts[k]!, 0));
    const t = Object.fromEntries(PNL_SECTIONS.map((sec) => [sec, total(sec)])) as Record<PnlSection, number[]>;
    const gross = columns.map((_c, k) => t.revenue[k]! - t.costOfSales[k]!);
    const operating = columns.map((_c, k) => gross[k]! - t.operatingExpenses[k]!);
    const costCentre = costCentreId === 'none' ? ('none' as const) : filter ? { id: filter.id, code: filter.code, name: filter.name } : null;
    return { from, to, compare, columns, costCentre, sections: PNL_SECTIONS.map((sec) => ({ section: sec, rows: rows.filter((r) => r.section === sec) as StatementRow[], total: t[sec] })), grossProfit: gross, operatingProfit: operating, netProfit: columns.map((_c, k) => operating[k]! + t.otherIncome[k]! - t.otherExpenses[k]!) };
  };
  const balanceSheet = async (asOf: string, compareAsOf: string | null): Promise<BalanceSheet> => {
    const dates = compareAsOf ? [asOf, compareAsOf] : [asOf];
    const cols = await Promise.all(dates.map((d) => sums(null, d)));
    const rows = await statementRows<BsSection>(cols, bsSectionOf, (type) => (type === 'asset' ? 1 : -1));
    const accs = await accounts.list(true);
    const profitOf = (m: Map<string, number>) => -accs.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + (m.get(a.id) ?? 0), 0);
    const unclosed = await Promise.all(
      dates.map(async (d, k) => {
        const yearStart = fiscalYearSpan(fiscalYearOf(d, 4), 4).startDate;
        const before = new Date(Date.parse(`${yearStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        const earlier = profitOf(await sums(null, before));
        return { thisYear: profitOf(cols[k]!) - earlier, earlier, yearStart };
      }),
    );
    const total = (sec: BsSection) => dates.map((_d, k) => rows.filter((r) => r.section === sec && r.depth === 0).reduce((s, r) => s + r.amounts[k]!, 0));
    const t = Object.fromEntries(BS_SECTIONS.map((sec) => [sec, total(sec)])) as Record<BsSection, number[]>;
    const assets = dates.map((_d, k) => t.currentAssets[k]! + t.nonCurrentAssets[k]!);
    const liabilities = dates.map((_d, k) => t.currentLiabilities[k]! + t.nonCurrentLiabilities[k]!);
    const equity = dates.map((_d, k) => t.equity[k]! + unclosed[k]!.thisYear + unclosed[k]!.earlier);
    return { asOf, compareAsOf, columns: dates, sections: BS_SECTIONS.map((sec) => ({ section: sec, rows: rows.filter((r) => r.section === sec) as StatementRow[], total: t[sec] })), profitThisYear: unclosed.map((u) => u.thisYear), profitEarlierYears: unclosed.map((u) => u.earlier), yearStart: unclosed.map((u) => u.yearStart), totalAssets: assets, totalLiabilities: liabilities, totalEquity: equity, balanced: dates.map((_d, k) => assets[k] === liabilities[k]! + equity[k]!) };
  };

  /** The dashboard from the demo's books, as the API works it out */
  const dashboard = async (): Promise<Dashboard> => {
    const today = todayIn('Asia/Kolkata');
    const thisMonth = today.slice(0, 7);
    const back = (n: number) => {
      const [y, m] = thisMonth.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
    };
    const months = Array.from({ length: 12 }, (_v, k) => back(11 - k));
    const accs = await accounts.list(true);
    const kindOf = new Map(accs.map((a) => [a.id, a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash') ? 'cash' : a.subtype === 'accounts_receivable' ? 'receivables' : a.subtype === 'accounts_payable' ? 'payables' : a.type === 'income' ? 'income' : a.type === 'expense' ? 'expense' : null]));
    const lines = (await postedLines()).filter((l) => l.date <= today);
    const upTo = (k: string, month: string) => lines.filter((l) => kindOf.get(l.accountId) === k && l.date.slice(0, 7) <= month).reduce((s, l) => s + l.debit - l.credit, 0);
    const inMonth = (k: string, month: string) => lines.filter((l) => kindOf.get(l.accountId) === k && l.date.slice(0, 7) === month).reduce((s, l) => s + l.debit - l.credit, 0);
    const monthly = months.map((m) => ({ month: m, income: -inMonth('income', m), expenses: inMonth('expense', m), profit: -inMonth('income', m) - inMonth('expense', m), cash: upTo('cash', m) }));
    const yearStart = fiscalYearSpan(fiscalYearOf(today, 4), 4).startDate.slice(0, 7);
    const ytd = (to: string) => monthly.filter((m) => m.month >= yearStart && m.month <= to).reduce((s, m) => s + m.profit, 0);
    const bal = (k: 'cash' | 'receivables' | 'payables', m: string) => (k === 'payables' ? -1 : 1) * upTo(k, m);
    const kpi = (k: 'cash' | 'receivables' | 'payables') => ({ value: bal(k, thisMonth), previous: bal(k, months[10]!), trend: months.map((m) => bal(k, m)) });
    const alerts: Dashboard['alerts'] = [];
    const invoices = (await (await import('../invoices/demoInvoicesApi')).demoInvoiceViews()).filter((i) => i.status === 'issued' && i.balance > 0 && i.dueDate < today);
    if (invoices.length) alerts.push({ kind: 'overdue_invoices', count: invoices.length, amount: invoices.reduce((s, i) => s + i.balance, 0) });
    const bills = (await import('../bills/demoBillsApi')).demoStoredBillViews().filter((b) => b.status === 'open' && b.balance > 0 && b.dueDate < today);
    if (bills.length) alerts.push({ kind: 'overdue_bills', count: bills.length, amount: bills.reduce((s, b) => s + b.balance, 0) });
    const drafts = (await journals.list({ status: 'draft', page: 1, pageSize: 1 })).total;
    if (drafts) alerts.push({ kind: 'draft_entries', count: drafts });
    const waiting = demoPendingApprovals();
    if (waiting) alerts.push({ kind: 'approvals_waiting', count: waiting });
    const low = (await import('../items/demoItemsApi')).demoItemRows().filter((i) => i.stock?.low && !i.archived).length;
    if (low) alerts.push({ kind: 'low_stock', count: low });
    return { asOf: today, baseCurrency: 'INR', kpis: { cash: kpi('cash'), receivables: kpi('receivables'), payables: kpi('payables'), profit: { value: ytd(thisMonth), previous: thisMonth === yearStart ? 0 : ytd(months[10]!), trend: monthly.map((m) => m.profit), since: `${yearStart}-01` } }, monthly, alerts, setup: { organisation: true, team: true, coa: true, fiscal: true, bank: true } };
  };

  /** The cash flow statement from the demo's books, both ways, as the API works it out */
  const cashFlow = async (from: string, to: string): Promise<CashFlow> => {
    const accs = await accounts.list(true);
    const isCash = (a: { type: string; subtype: string }) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash');
    const cashIds = new Set(accs.filter(isCash).map((a) => a.id));
    const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    // One read of the books for everything below
    const posted = await postedLines();
    const [moves, opening, closing] = await Promise.all([sums(from, to, posted), sums(null, before, posted), sums(null, to, posted)]);
    const cashOf = (m: Map<string, number>) => [...cashIds].reduce((s, id) => s + (m.get(id) ?? 0), 0);
    const change = (id: string) => moves.get(id) ?? 0;
    const netProfit = -accs.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + change(a.id), 0);
    const depreciation = accs.filter((a) => a.subtype === 'depreciation').reduce((s, a) => s + change(a.id), 0);
    const rows = (pick: (a: (typeof accs)[number]) => boolean) => accs.filter(pick).map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: -change(a.id) })).filter((r) => r.amount !== 0).sort((x, y) => compareCodes(x.code, y.code));
    const sec = (a: (typeof accs)[number]) => bsSectionOf(a.type, a.subtype);
    const workingCapital = rows((a) => (a.type === 'asset' && !isCash(a) && sec(a) === 'currentAssets') || (a.type === 'liability' && sec(a) === 'currentLiabilities'));
    const investingRows = rows((a) => a.type === 'asset' && sec(a) === 'nonCurrentAssets');
    const financingRows = rows((a) => (a.type === 'liability' && sec(a) === 'nonCurrentLiabilities') || a.type === 'equity');
    const sum = (r: { amount: number }[]) => r.reduce((s, x) => s + x.amount, 0);
    const operating = netProfit + depreciation + sum(workingCapital);
    const investing = sum(investingRows) - depreciation;
    const financing = sum(financingRows);
    const direct = { customers: 0, otherReceipts: 0, vendors: 0, staff: 0, taxes: 0, otherPayments: 0, investing: 0, financing: 0 };
    const byId = new Map(accs.map((a) => [a.id, a]));
    const entries = new Map<string, { accountId: string; net: number }[]>();
    for (const l of posted.filter((x) => x.date >= from && x.date <= to)) entries.set(l.entryId, [...(entries.get(l.entryId) ?? []), { accountId: l.accountId, net: l.debit - l.credit }]);
    for (const ls of entries.values()) {
      const cash = ls.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s + l.net, 0);
      const others = ls.filter((l) => !cashIds.has(l.accountId) && l.net);
      if (!cash || !others.length) continue;
      const weight = others.reduce((s, l) => s + Math.abs(l.net), 0);
      let left = cash;
      others.forEach((l, k) => {
        const share = k === others.length - 1 ? left : Math.round((cash * Math.abs(l.net)) / weight);
        left -= share;
        const a = byId.get(l.accountId)!;
        const key = a.subtype === 'accounts_receivable' || a.subtype === 'operating_income' ? 'customers' : ['accounts_payable', 'credit_card', 'cost_of_sales', 'operating_expense', 'other_expense'].includes(a.subtype) ? 'vendors' : a.subtype === 'payroll' ? 'staff' : a.subtype === 'tax_payable' ? 'taxes' : sec(a) === 'nonCurrentAssets' ? 'investing' : sec(a) === 'nonCurrentLiabilities' || sec(a) === 'equity' ? 'financing' : cash > 0 ? 'otherReceipts' : 'otherPayments';
        direct[key] += share;
      });
    }
    const directOperating = direct.customers + direct.otherReceipts + direct.vendors + direct.staff + direct.taxes + direct.otherPayments;
    return { from, to, openingCash: cashOf(opening), closingCash: cashOf(closing), netChange: cashOf(closing) - cashOf(opening), indirect: { netProfit, depreciation, workingCapital, operating, investingRows, investing, financingRows, financing, total: operating + investing + financing }, direct: { ...direct, operating: directOperating, total: directOperating + direct.investing + direct.financing } };
  };

  const headOf = (kind: string): keyof GstHeads | null => (kind === 'igst' ? 'igst' : kind === 'cgst' ? 'cgst' : kind === 'sgst' || kind === 'utgst' ? 'sgst' : kind === 'cess' ? 'cess' : null);
  /** GSTR-3B from the demo's tax summary, set off as the API does */
  const gstr3b = async (from: string, to: string): Promise<Gstr3b> => {
    const t = await taxSummary(from, to);
    const output = zeroHeads();
    const itc = zeroHeads();
    for (const r of t.rates) {
      const h = headOf(r.kind);
      if (!h) continue;
      output[h] += r.output;
      itc[h] += r.input;
    }
    const setOff = gstSetOff(output, itc);
    return { from, to, gstin: null, outward: { taxable: t.totals.outwardTaxable, ...output }, outwardUntaxed: 0, itc, inwardTaxable: t.totals.inwardTaxable, setOff, payable: setOff.cash, carriedForward: setOff.carriedForward };
  };
  /** GSTR-1 from the demo's invoices and credit notes */
  const gstr1 = async (from: string, to: string): Promise<Gstr1> => {
    const tax = demoTaxState();
    const { demoInvoiceViews } = await import('../invoices/demoInvoicesApi');
    const { demoContactRows } = await import('../contacts/demoContactsApi');
    const { demoCreditNoteRows } = await import('../credit-notes/demoCreditNotesApi');
    const contacts = demoContactRows();
    const invoices = (await demoInvoiceViews()).filter((i) => i.number && i.issueDate >= from && i.issueDate <= to).sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''));
    const split = (net: number, groupId: string | null | undefined) => {
      const g = tax.groups.find((x) => x.id === groupId);
      const rates = (g?.rateIds ?? []).map((id) => tax.rates.find((r) => r.id === id)!);
      const heads = zeroHeads();
      splitTax(net, false, rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }))).taxes.forEach((p, k) => {
        const h = headOf(rates[k]!.kind);
        if (h) heads[h] += p.amount;
      });
      return { heads, rate: rates.filter((r) => ['igst', 'cgst', 'sgst', 'utgst'].includes(r.kind)).reduce((s, r) => s + r.ratePpm, 0) / 10_000 };
    };
    const byRate = (lines: { amount: number; taxGroup: { id: string } | null }[]) => {
      const m = new Map<number, GstRateRow>();
      for (const l of lines) {
        const s = split(l.amount, l.taxGroup?.id);
        const row = m.get(s.rate) ?? { rate: s.rate, taxable: 0, ...zeroHeads() };
        row.taxable += l.amount;
        for (const k of ['igst', 'cgst', 'sgst', 'cess'] as const) row[k] += s.heads[k];
        m.set(s.rate, row);
      }
      return [...m.values()];
    };
    const out: Gstr1 = { from, to, gstin: null, legalName: 'Nest Demo Pvt. Ltd.', b2b: [], b2cl: [], b2cs: [], exports: [], cdnr: [], cdnur: [], hsn: [], documents: { invoices: { first: invoices[0]?.number ?? null, last: invoices.at(-1)?.number ?? null, total: invoices.length, cancelled: invoices.filter((i) => i.status === 'void').length }, creditNotes: { total: 0, cancelled: 0 } } };
    const hsn = new Map<string, Gstr1['hsn'][number]>();
    for (const i of invoices.filter((x) => x.status === 'issued')) {
      const items = byRate(i.lines);
      for (const l of i.lines) {
        const s = split(l.amount, l.taxGroup?.id);
        const key = `${l.item?.hsnSac ?? ''}|${s.rate}`;
        const h = hsn.get(key) ?? { hsn: l.item?.hsnSac ?? '', unit: l.item?.unit ?? null, quantity: '0', returned: false, rate: s.rate, taxable: 0, ...zeroHeads() };
        h.quantity = String(Number(h.quantity) + Number(l.quantity));
        h.taxable += l.amount;
        for (const k of ['igst', 'cgst', 'sgst', 'cess'] as const) h[k] += s.heads[k];
        hsn.set(key, h);
      }
      const doc = { number: i.number!, date: i.issueDate, value: i.total, items };
      const taxId = contacts.find((c) => c.id === i.contact.id)?.taxId;
      if (taxId && isGstin(taxId)) out.b2b.push({ gstin: taxId, name: i.contact.name, placeOfSupply: i.placeOfSupply, ...doc });
      else if (!i.placeOfSupply) out.exports.push({ ...doc, currency: i.currency });
      else if (i.placeOfSupply !== '27' && i.total > B2CL_THRESHOLD) out.b2cl.push({ placeOfSupply: i.placeOfSupply, ...doc });
      else for (const r of items) out.b2cs.push({ placeOfSupply: i.placeOfSupply, type: i.placeOfSupply === '27' ? 'intra' : 'inter', ...r });
    }
    for (const n of demoCreditNoteRows().filter((x) => x.date >= from && x.date <= to)) {
      out.documents.creditNotes.total++;
      if (n.status === 'void') {
        out.documents.creditNotes.cancelled++;
        continue;
      }
      const taxId = contacts.find((c) => c.id === n.contact.id)?.taxId;
      const doc = { name: n.contact.name, number: n.number, date: n.date, invoice: n.invoice.number, value: n.total, items: byRate(n.lines) };
      if (taxId && isGstin(taxId)) out.cdnr.push({ gstin: taxId, ...doc });
      else out.cdnur.push(doc);
    }
    out.hsn = [...hsn.values()];
    return out;
  };

  const csv = (rows: unknown[][]) => new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const money = (n: number) => (n / 100).toFixed(2);
  const guard = () => {
    if (!canExport()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['reports.export'] });
  };
  return {
    gstr3b,
    gstr1,
    async exportGstr1(from, to, format) {
      guard();
      const g = await gstr1(from, to);
      if (format === 'json') return { filename: `gstr-1-${from}-${to}.json`, blob: new Blob([JSON.stringify(g, null, 2)], { type: 'application/json' }) };
      const rows: unknown[][] = [['section', 'gstin', 'name', 'document', 'date', 'place_of_supply', 'rate', 'taxable_value', 'igst', 'cgst', 'sgst', 'cess']];
      for (const i of g.b2b) for (const r of i.items) rows.push(['b2b', i.gstin, i.name, i.number, i.date, i.placeOfSupply, r.rate, money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst), money(r.cess)]);
      for (const r of g.b2cs) rows.push(['b2cs', '', '', '', '', r.placeOfSupply, r.rate, money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst), money(r.cess)]);
      return { filename: `gstr-1-${from}-${to}.csv`, blob: csv(rows) };
    },
    cashFlow,
    async exportCashFlow(from, to) {
      guard();
      const c = await cashFlow(from, to);
      const i = c.indirect;
      const rows: unknown[][] = [['section', 'line', 'amount'], ['operating', 'Net profit', money(i.netProfit)], ['operating', 'Depreciation', money(i.depreciation)], ...i.workingCapital.map((r) => ['operating', `Change in ${r.code} ${r.name}`, money(r.amount)]), ['operating', 'Cash from operating activities', money(i.operating)], ['investing', 'Cash from investing activities', money(i.investing)], ['financing', 'Cash from financing activities', money(i.financing)], ['', 'Net change in cash', money(c.netChange)], ['', 'Cash at the start', money(c.openingCash)], ['', 'Cash at the end', money(c.closingCash)]];
      return { filename: `cash-flow-${from}-${to}.csv`, blob: csv(rows) };
    },
    dashboard,
    trialBalance,
    ledger,
    taxSummary,
    profitAndLoss,
    async exportProfitAndLoss(from, to, compare, costCentreId) {
      guard();
      const p = await profitAndLoss(from, to, compare, costCentreId);
      const rows: unknown[][] = [['section', 'code', 'account', ...p.columns.map((c) => (c.costCentre !== undefined ? (c.costCentre ? `${c.costCentre.code} ${c.costCentre.name}` : 'Unassigned') : `${c.from}..${c.to}`))]];
      for (const sec of p.sections) {
        for (const r of sec.rows) rows.push([sec.section, r.code, `${'  '.repeat(r.depth)}${r.name}`, ...r.amounts.map(money)]);
        rows.push([sec.section, '', `Total ${sec.section}`, ...sec.total.map(money)]);
        if (sec.section === 'costOfSales') rows.push(['', '', 'Gross profit', ...p.grossProfit.map(money)]);
        if (sec.section === 'operatingExpenses') rows.push(['', '', 'Operating profit', ...p.operatingProfit.map(money)]);
      }
      rows.push(['', '', 'Net profit', ...p.netProfit.map(money)]);
      return { filename: `profit-and-loss-${from}-${to}.csv`, blob: csv(rows) };
    },
    balanceSheet,
    async exportBalanceSheet(asOf, compareAsOf) {
      guard();
      const b = await balanceSheet(asOf, compareAsOf);
      const rows: unknown[][] = [['section', 'code', 'account', ...b.columns]];
      for (const sec of b.sections) {
        for (const r of sec.rows) rows.push([sec.section, r.code, `${'  '.repeat(r.depth)}${r.name}`, ...r.amounts.map(money)]);
        if (sec.section === 'equity') rows.push(['equity', '', 'Profit for the year to date', ...b.profitThisYear.map(money)], ['equity', '', 'Total equity', ...b.totalEquity.map(money)]);
        else rows.push([sec.section, '', `Total ${sec.section}`, ...sec.total.map(money)]);
      }
      rows.push(['', '', 'Total assets', ...b.totalAssets.map(money)], ['', '', 'Total liabilities and equity', ...b.columns.map((_c, k) => money(b.totalLiabilities[k]! + b.totalEquity[k]!))]);
      return { filename: `balance-sheet-${asOf}.csv`, blob: csv(rows) };
    },
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
