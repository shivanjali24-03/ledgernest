import { currencyDigits, enteredLines, invoiceNumber, expandTax, journalDraftSchema, journalNumber, postingProblem, realisedDifferences, sniffAttachmentType, todayIn, toBase, totals, type EnteredLine } from '@ledgernest/shared';
import { DEMO_BASE_CURRENCY, demoRateOn } from '../currencies/demoCurrenciesApi';
import { ApiError } from '../auth/client';
import { demoCostCentreRows } from '../cost-centres/demoCostCentresApi';
import { createDemoAccountsApi, demoAccountRows, demoEnsureFxAccount, sampleId } from '../accounts/demoAccountsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { createDemoPeriodsApi, demoClosingEntryIds } from '../periods/demoPeriodsApi';
import type { JournalEntry, JournalsApi, JournalSummary } from './types';

/**
 * Journal entries in demo mode: a month of realistic entries for the sample company (GST sales,
 * rent, payroll, a corrected card charge) plus a draft. Same rules as the API: balance, open months,
 * active accounts, final posted entries, reversals linked both ways.
 */

// v2: lines carry tax (the sample sale's GST is generated from the GST 18% group)
const KEY = 'ledgernest.demo.journals.v2';
type StoredLine = {
  accountId: string;
  description: string | null;
  debit: number;
  credit: number;
  taxGroupId?: string | null;
  taxInclusive?: boolean;
  taxRateId?: string | null;
  taxSourceLine?: number | null;
  currency?: string | null;
  foreignDebit?: number;
  foreignCredit?: number;
  rate?: string | null;
  fxSourceLine?: number | null;
  costCentreId?: string | null;
};

/** The demo company's lines as stored, from the lines as entered: the same tax rules as the API. */
function expandDemo(lines: readonly EnteredLine[]) {
  const tax = demoTaxState();
  const accounts = demoAccountRows();
  const { rows, tooSmall } = expandTax(
    lines,
    (id) => {
      const g = tax.groups.find((x) => x.id === id);
      return g?.rateIds.map((rid) => tax.rates.find((r) => r.id === rid)!).map((r) => ({ id: r.id, ratePpm: r.ratePpm, outputAccountId: r.outputAccountId, inputAccountId: r.inputAccountId }));
    },
    (id) => accounts.find((a) => a.id === id)?.type,
  );
  return { rows: rows.map(({ lineNo: _n, ...r }) => r), tooSmall };
}
type Stored = {
  id: string;
  number: number | null;
  yearName: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  status: 'draft' | 'posted';
  reversalOfId: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: StoredLine[];
  attachments: { id: string; fileName: string; contentType: string; size: number; data: string; createdAt: string }[];
};

const ME = { name: 'Shivanjali Desai', email: 'admin@ledgernest.demo' };
const dayOffset = (days: number) => {
  const d = new Date(`${todayIn('Asia/Kolkata')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const thisMonth = (day: number) => `${todayIn('Asia/Kolkata').slice(0, 8)}${String(Math.min(day, Number(todayIn('Asia/Kolkata').slice(8)))).padStart(2, '0')}`;

function seed(yearName: string): Stored[] {
  const a = sampleId;
  let n = 0;
  const entry = (date: string, memo: string, reference: string | null, lines: [string, number, number, string?][], extra: Partial<Stored> = {}): Stored => ({
    id: crypto.randomUUID(),
    number: extra.status === 'draft' ? null : ++n,
    yearName: extra.status === 'draft' ? null : yearName,
    date,
    memo,
    reference,
    status: 'posted',
    reversalOfId: null,
    postedAt: `${date}T12:00:00Z`,
    createdAt: `${date}T11:00:00Z`,
    lines: lines.map(([code, debit, credit, description]) => ({ accountId: a(code), debit, credit, description: description ?? null })),
    attachments: [],
    ...extra,
  });
  // Money the owners put in, so the bank starts in credit like a real company's
  const capital = entry(thisMonth(1), 'Share capital introduced', 'BOARD-RES-07', [
    ['1100.01', 250000000, 0],
    ['3100', 0, 250000000],
  ]);
  // Invoice 1 of the year (the demo's Invoices page shows it)
  const sale = entry(thisMonth(2), `Invoice ${invoiceNumber(yearName, 1)} · Kumar Logistics`, invoiceNumber(yearName, 1), [
    ['1300', 11800000, 0],
    ['4100.01', 0, 10000000, 'Software development, sprint 14'],
  ]);
  // GST 18% within Maharashtra: CGST 9% + SGST 9%, generated like the API does
  const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%');
  if (gst18) sale.lines = expandDemo(sale.lines.map((l, i) => ({ ...l, taxGroupId: i === 1 ? gst18.id : null }))).rows;
  const rent = entry(thisMonth(3), 'Office rent', 'RENT-NOV', [
    ['5300', 8500000, 0],
    ['1100.01', 0, 8500000],
  ]);
  const payroll = entry(thisMonth(5), 'Salaries for the month', 'PAY-11', [
    ['5200.01', 42000000, 0],
    ['2400', 0, 42000000],
  ]);
  const cloud = entry(thisMonth(6), 'AWS bill', 'AWS-8812', [
    ['5100', 3650000, 0],
    ['2500', 0, 3650000],
  ]);
  const fix = entry(thisMonth(7), `Reversal of ${journalNumber(yearName, 5)}`, 'AWS-8812', [
    ['5100', 0, 3650000],
    ['2500', 3650000, 0],
  ]);
  fix.reversalOfId = cloud.id;
  const cloudRight = entry(thisMonth(7), 'AWS bill (corrected amount)', 'AWS-8812', [
    ['5100', 3820000, 0],
    ['2500', 0, 3820000],
  ]);
  const receipt = entry(dayOffset(0), 'Payment from Kumar Logistics', 'UTR 402918', [['1100.01', 11800000, 0], ['1300', 0, 11800000]], { status: 'draft', postedAt: null });
  // The sample company's branches: the sale and the rent belong to Pune, the cloud bill to Mumbai
  const [pune, mumbai] = demoCostCentreRows();
  for (const [e, code] of [[sale, '4100.01'], [rent, '5300'], [cloud, '5100'], [fix, '5100'], [cloudRight, '5100']] as const) {
    const l = e.lines.find((x) => x.accountId === a(code));
    if (l) l.costCentreId = (e === sale || e === rent ? pune : mumbai)?.id ?? null;
  }
  return [capital, sale, rent, payroll, cloud, fix, cloudRight, receipt];
}

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

/** How many of the demo's journal lines are tagged with a cost centre */
export const demoJournalLinesTagged = (costCentreId: string) => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored[]).reduce((n, e) => n + e.lines.filter((l) => l.costCentreId === costCentreId).length, 0) : 0;
  } catch {
    return 0;
  }
};

export const resetDemoJournals = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** What the demo's financial years need from journals to close a year (the API does this inside one transaction). */
export interface DemoYearEnd {
  /** Income and expense balances for the range, as closing lines, and the profit (negative: loss) */
  yearEnd(startDate: string, endDate: string): Promise<{ lines: { accountId: string; debit: number; credit: number }[]; profit: number }>;
  /** Posts the closing entry on the year's last day; null when there was nothing to move */
  closeYear(yearName: string, startDate: string, endDate: string): Promise<string | null>;
  /** Reverses a closing entry when the year's last month reopens */
  reopenYear(entryId: string, yearName: string, endDate: string): Promise<void>;
  /** The entry's number, e.g. JV/2025-26/0012 */
  numberOf(entryId: string): Promise<string | null>;
  /** Revalues foreign-currency accounts at a day's rate (Currencies → Revalue) */
  revalue(date: string): Promise<{ date: string; entry: { id: string; number: string } | null; adjustments: { accountId: string; code: string; name: string; currency: string; foreignBalance: number; rate: string; before: number; after: number; difference: number }[]; missingRates: string[] }>;
}

export function createDemoJournalsApi(can: (p: 'journals.create' | 'journals.post' | 'journals.reverse') => boolean): JournalsApi & DemoYearEnd {
  const accounts = createDemoAccountsApi(() => true);
  const periods = createDemoPeriodsApi(() => true);

  /** The open/closed state of a day, and its financial year's name. */
  const dayInfo = async (day: string) => {
    const { years } = await periods.list();
    for (const y of years) for (const p of y.periods) if (p.startDate <= day && day <= p.endDate) return { status: p.status, yearName: y.name };
    return { status: 'no_period' as const, yearName: null };
  };
  const load = async (): Promise<Stored[]> => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Stored[];
    } catch {
      /* fall through */
    }
    const s = seed((await dayInfo(todayIn('Asia/Kolkata'))).yearName ?? 'FY');
    save(s);
    return s;
  };
  const save = (s: Stored[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  };
  const guard = (p: 'journals.create' | 'journals.post' | 'journals.reverse') => {
    if (!can(p)) throw new ApiError('forbidden', 403, undefined, undefined, { missing: [p] });
  };
  const label = (e: Stored | undefined) => (e?.number && e.yearName ? journalNumber(e.yearName, e.number) : null);

  const view = async (all: Stored[], e: Stored): Promise<JournalEntry> => {
    const accs = new Map((await accounts.list(true)).map((x) => [x.id, x]));
    const reversedBy = all.find((x) => x.reversalOfId === e.id);
    const reversalOf = all.find((x) => x.id === e.reversalOfId);
    const tax = demoTaxState();
    const centres = demoCostCentreRows().map(({ id, code, name }) => ({ id, code, name }));
    return {
      id: e.id,
      number: label(e),
      date: e.date,
      memo: e.memo,
      reference: e.reference,
      status: e.status,
      postedAt: e.postedAt,
      createdAt: e.createdAt,
      createdBy: ME,
      postedBy: e.status === 'posted' ? ME : null,
      reversalOf: reversalOf ? { id: reversalOf.id, number: label(reversalOf) } : null,
      reversedBy: reversedBy ? { id: reversedBy.id, number: label(reversedBy) } : null,
      lines: e.lines.map((l, i) => {
        const a = accs.get(l.accountId);
        const group = l.taxGroupId ? tax.groups.find((g) => g.id === l.taxGroupId) : undefined;
        const rate = l.taxRateId ? tax.rates.find((r) => r.id === l.taxRateId) : undefined;
        return {
          id: `${e.id}-${i}`,
          lineNo: i + 1,
          accountId: l.accountId,
          account: { code: a?.code ?? '?', name: a?.name ?? '?', type: a?.type ?? 'asset', currency: a?.currency ?? null },
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          taxGroup: group ? { id: group.id, name: group.name } : null,
          taxInclusive: !!l.taxInclusive,
          taxRate: rate ? { id: rate.id, name: rate.name, kind: rate.kind, ratePpm: rate.ratePpm } : null,
          taxSourceLine: l.taxSourceLine ?? null,
          currency: l.currency ?? null,
          foreignDebit: l.foreignDebit ?? 0,
          foreignCredit: l.foreignCredit ?? 0,
          rate: l.rate ?? null,
          fxSourceLine: l.fxSourceLine ?? null,
          costCentre: (l.costCentreId && centres.find((c) => c.id === l.costCentreId)) || null,
        };
      }),
      totals: totals(e.lines),
      attachments: e.attachments.map(({ data: _d, ...rest }) => rest),
    };
  };
  const checkAccounts = async (lines: StoredLine[]) => {
    const accs = new Map((await accounts.list(true)).map((x) => [x.id, x]));
    for (const l of lines) {
      const a = accs.get(l.accountId);
      if (!a) throw refuse(400, 'account_not_found');
      if (a.archived) throw refuse(400, 'account_archived');
    }
  };
  const parse = (input: unknown) => {
    const r = journalDraftSchema.safeParse(input);
    if (!r.success) throw new ApiError('validation', 400, undefined, undefined, { fields: r.error.issues });
    return r.data;
  };
  /** Checks the lines' accounts and tax groups, then generates the tax lines. */
  /** Lines on foreign-currency accounts are in that currency, converted at the line's rate or the day's (as the API does). */
  const convert = (lines: EnteredLine[], date: string): EnteredLine[] => {
    const accs = demoAccountRows();
    return lines.map((l, i) => {
      const cur = accs.find((a) => a.id === l.accountId)?.currency ?? null;
      if (cur && l.currency !== cur) throw refuse(400, 'currency_required', { line: i + 1, currency: cur });
      if (!l.currency) return l;
      if (l.currency !== cur) throw refuse(400, 'currency_mismatch', { line: i + 1 });
      const rate = l.rate ?? demoRateOn(l.currency, date);
      if (!rate) throw refuse(400, 'no_rate', { line: i + 1, currency: l.currency, date });
      const base = toBase((l.foreignDebit ?? 0) || (l.foreignCredit ?? 0), rate, currencyDigits(l.currency), currencyDigits(DEMO_BASE_CURRENCY));
      if (base <= 0) throw refuse(400, 'amount_too_small', { line: i + 1 });
      return { ...l, rate, debit: l.foreignDebit ? base : 0, credit: l.foreignDebit ? 0 : base };
    });
  };
  const linesFor = async (entered: EnteredLine[], date: string): Promise<StoredLine[]> => {
    await checkAccounts(entered);
    const centres = demoCostCentreRows();
    for (const l of entered) {
      if (!l.costCentreId) continue;
      const c = centres.find((x) => x.id === l.costCentreId);
      if (!c) throw refuse(400, 'cost_centre_not_found');
      if (c.archived) throw refuse(400, 'cost_centre_archived');
    }
    const lines = convert(entered, date);
    const tax = demoTaxState();
    for (const l of lines) {
      if (!l.taxGroupId) continue;
      const g = tax.groups.find((x) => x.id === l.taxGroupId);
      if (!g) throw refuse(400, 'tax_group_not_found');
      if (g.archivedAt) throw refuse(400, 'tax_group_archived');
    }
    const { rows, tooSmall } = expandDemo(lines);
    if (tooSmall !== null) throw refuse(400, 'tax_too_small', { line: tooSmall });
    return rows;
  };
  const postInto = async (all: Stored[], e: Stored, { system = false } = {}) => {
    const problem = postingProblem(e.lines);
    if (problem) throw refuse(400, problem, totals(e.lines));
    if (!system) await checkAccounts(e.lines);
    const info = await dayInfo(e.date);
    if (info.status === 'no_period') throw refuse(409, 'no_period');
    if (info.status === 'closed') throw refuse(409, 'period_closed');
    e.status = 'posted';
    e.yearName = info.yearName;
    e.number = Math.max(0, ...all.filter((x) => x.yearName === info.yearName && x.number).map((x) => x.number!)) + 1;
    e.postedAt = new Date().toISOString();
  };
  const find = (all: Stored[], id: string) => {
    const e = all.find((x) => x.id === id);
    if (!e) throw new ApiError('not_found', 404);
    return e;
  };

  const reversalOf = (e: Stored, date: string, memo: string): Stored => ({
    id: crypto.randomUUID(),
    number: null,
    yearName: null,
    date,
    memo,
    reference: e.reference,
    status: 'draft',
    reversalOfId: e.id,
    postedAt: null,
    createdAt: new Date().toISOString(),
    lines: e.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, foreignDebit: l.foreignCredit ?? 0, foreignCredit: l.foreignDebit ?? 0 })),
    attachments: [],
  });
  const yearEnd = async (startDate: string, endDate: string) => {
    const all = await load();
    const types = new Map(demoAccountRows().map((a) => [a.id, a.type]));
    const net = new Map<string, number>();
    for (const e of all) {
      if (e.status !== 'posted' || e.date < startDate || e.date > endDate) continue;
      for (const l of e.lines) if (['income', 'expense'].includes(types.get(l.accountId) ?? '')) net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debit - l.credit);
    }
    const lines = [...net].filter(([, n]) => n !== 0).map(([accountId, n]) => ({ accountId, debit: n < 0 ? -n : 0, credit: n > 0 ? n : 0 }));
    return { lines, profit: -[...net.values()].reduce((a, b) => a + b, 0) };
  };

  /** Moves every foreign-currency account to a day's rate in one entry, booking to Unrealised exchange gain or loss. */
  const revalue = async (date: string) => {
    const all = await load();
    const accs = demoAccountRows().filter((a) => a.currency);
    const adjustments: { accountId: string; code: string; name: string; currency: string; foreignBalance: number; rate: string; before: number; after: number; difference: number }[] = [];
    const missing = new Set<string>();
    for (const a of accs) {
      let f = 0;
      let b = 0;
      for (const x of all) {
        if (x.status !== 'posted' || x.date > date) continue;
        for (const l of x.lines) {
          if (l.accountId !== a.id) continue;
          f += (l.foreignDebit ?? 0) - (l.foreignCredit ?? 0);
          b += l.debit - l.credit;
        }
      }
      if (!f && !b) continue;
      const rate = demoRateOn(a.currency!, date);
      if (!rate) {
        if (f) missing.add(a.currency!);
        continue;
      }
      const after = toBase(f, rate, currencyDigits(a.currency!), currencyDigits(DEMO_BASE_CURRENCY));
      if (after !== b) adjustments.push({ accountId: a.id, code: a.code, name: a.name, currency: a.currency!, foreignBalance: f, rate, before: b, after, difference: after - b });
    }
    let entry: { id: string; number: string } | null = null;
    if (adjustments.length) {
      const fx = demoEnsureFxAccount('fx_unrealised');
      const e: Stored = {
        id: crypto.randomUUID(),
        number: null,
        yearName: null,
        date,
        memo: `Revaluation of foreign-currency balances at ${date}`,
        reference: null,
        status: 'draft',
        reversalOfId: null,
        postedAt: null,
        createdAt: new Date().toISOString(),
        lines: adjustments.flatMap((x) => {
          const amount = Math.abs(x.difference);
          const up = x.difference > 0;
          return [
            { accountId: x.accountId, currency: x.currency, description: `${x.currency} at ${x.rate}`, debit: up ? amount : 0, credit: up ? 0 : amount },
            { accountId: fx, description: `${x.code} ${x.currency} at ${x.rate}`, debit: up ? 0 : amount, credit: up ? amount : 0 },
          ];
        }),
        attachments: [],
      };
      await postInto(all, e, { system: true });
      all.push(e);
      save(all);
      entry = { id: e.id, number: label(e)! };
    }
    return { date, entry, adjustments, missingRates: [...missing].sort() };
  };

  return {
    revalue,
    yearEnd,
    async closeYear(yearName, startDate, endDate) {
      const { lines, profit } = await yearEnd(startDate, endDate);
      if (!lines.length) return null;
      if (profit) lines.push({ accountId: sampleId('3900'), debit: profit < 0 ? -profit : 0, credit: profit > 0 ? profit : 0 });
      const all = await load();
      const e: Stored = { id: crypto.randomUUID(), number: null, yearName: null, date: endDate, memo: `Year-end close ${yearName}`, reference: null, status: 'draft', reversalOfId: null, postedAt: null, createdAt: new Date().toISOString(), lines: lines.map((l) => ({ ...l, description: null })), attachments: [] };
      await postInto(all, e, { system: true });
      all.push(e);
      save(all);
      return e.id;
    },
    async reopenYear(entryId, yearName, endDate) {
      const all = await load();
      const r = reversalOf(find(all, entryId), endDate, `Year-end close of ${yearName} reversed (year reopened)`);
      await postInto(all, r, { system: true });
      all.push(r);
      save(all);
    },
    async numberOf(entryId) {
      return label((await load()).find((x) => x.id === entryId));
    },
    list: (q) =>
      wait(async () => {
        const all = await load();
        const s = q.search?.trim().toLowerCase();
        const items = all
          .filter((e) => (!q.status || e.status === q.status) && (!q.accountId || e.lines.some((l) => l.accountId === q.accountId)) && (!q.from || e.date >= q.from) && (!q.to || e.date <= q.to))
          .filter((e) => !s || `${e.memo ?? ''} ${e.reference ?? ''}`.toLowerCase().includes(s))
          .sort((x, y) => y.date.localeCompare(x.date) || (y.number ?? 1e9) - (x.number ?? 1e9));
        const page = items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
        return {
          total: items.length,
          page: q.page,
          pageSize: q.pageSize,
          items: page.map(
            (e): JournalSummary => ({
              id: e.id,
              number: label(e),
              date: e.date,
              memo: e.memo,
              reference: e.reference,
              status: e.status,
              lineCount: e.lines.length,
              totals: totals(e.lines),
              reversalOf: e.reversalOfId ? { id: e.reversalOfId, number: label(all.find((x) => x.id === e.reversalOfId)) } : null,
              reversed: all.some((x) => x.reversalOfId === e.id),
              attachmentCount: e.attachments.length,
            }),
          ),
        };
      }),
    get: (id) =>
      wait(async () => {
        const all = await load();
        return view(all, find(all, id));
      }),
    create: (input) =>
      wait(async () => {
        guard('journals.create');
        const d = parse(input);
        const lines = await linesFor(d.lines, d.date);
        const all = await load();
        const e: Stored = { id: crypto.randomUUID(), number: null, yearName: null, date: d.date, memo: d.memo, reference: d.reference, status: 'draft', reversalOfId: null, postedAt: null, createdAt: new Date().toISOString(), lines, attachments: [] };
        all.push(e);
        save(all);
        return view(all, e);
      }),
    update: (id, input) =>
      wait(async () => {
        guard('journals.create');
        const d = parse(input);
        const all = await load();
        const e = find(all, id);
        if (e.status !== 'draft') throw refuse(409, 'posted');
        const lines = await linesFor(d.lines, d.date);
        Object.assign(e, { date: d.date, memo: d.memo, reference: d.reference, lines });
        save(all);
        return view(all, e);
      }),
    remove: (id) =>
      wait(async () => {
        guard('journals.create');
        const all = await load();
        if (find(all, id).status !== 'draft') throw refuse(409, 'posted');
        save(all.filter((x) => x.id !== id));
      }),
    post: (id) =>
      wait(async () => {
        guard('journals.post');
        const all = await load();
        const e = find(all, id);
        if (e.status !== 'draft') throw refuse(409, 'posted');
        // Tax lines are recomputed from the rates' current accounts, as the API does
        if (e.lines.some((l) => l.taxGroupId || l.taxRateId)) e.lines = await linesFor(enteredLines(e.lines.map((l, i) => ({ ...l, lineNo: i + 1, taxGroupId: l.taxGroupId ?? null, taxInclusive: !!l.taxInclusive, taxRateId: l.taxRateId ?? null, taxSourceLine: l.taxSourceLine ?? null }))), e.date);
        // Settling foreign balances realises exchange differences (shared with the API, so the figures match)
        if (e.lines.some((l) => l.currency && !l.fxSourceLine)) {
          const before = (accountId: string) => {
            let foreign = 0;
            let base = 0;
            for (const x of all) {
              if (x.status !== 'posted') continue;
              for (const l of x.lines) {
                if (l.accountId !== accountId) continue;
                foreign += (l.foreignDebit ?? 0) - (l.foreignCredit ?? 0);
                base += l.debit - l.credit;
              }
            }
            return { foreign, base };
          };
          const diffs = realisedDifferences(
            e.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, currency: l.fxSourceLine ? null : (l.currency ?? null), foreignDebit: l.foreignDebit ?? 0, foreignCredit: l.foreignCredit ?? 0, debit: l.debit, credit: l.credit })),
            before,
          );
          for (const d of diffs) {
            const fx = demoEnsureFxAccount('fx_realised');
            const amount = Math.abs(d.adjust);
            e.lines.push({ accountId: d.accountId, description: null, currency: d.currency, debit: d.adjust > 0 ? amount : 0, credit: d.adjust > 0 ? 0 : amount, fxSourceLine: d.sourceLine });
            e.lines.push({ accountId: fx, description: null, debit: d.adjust > 0 ? 0 : amount, credit: d.adjust > 0 ? amount : 0, fxSourceLine: d.sourceLine });
          }
        }
        await postInto(all, e);
        save(all);
        return view(all, e);
      }),
    reverse: (id, input) =>
      wait(async () => {
        guard('journals.reverse');
        const all = await load();
        const e = find(all, id);
        if (e.status !== 'posted') throw refuse(409, 'not_posted');
        if (all.some((x) => x.reversalOfId === id)) throw refuse(409, 'already_reversed');
        if (e.reversalOfId) throw refuse(409, 'is_reversal');
        if (demoClosingEntryIds().includes(id)) throw refuse(409, 'closing_entry');
        const r = reversalOf(e, input.date ?? e.date, input.memo || `Reversal of ${label(e)}`);
        await postInto(all, r);
        all.push(r);
        save(all);
        return view(all, r);
      }),
    attach: (id, file) =>
      wait(async () => {
        guard('journals.create');
        const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
        if (sniffAttachmentType(bytes) !== file.type) throw refuse(400, 'type_mismatch');
        const all = await load();
        const e = find(all, id);
        e.attachments.push({ id: crypto.randomUUID(), fileName: file.fileName, contentType: file.type, size: bytes.length, data: file.data, createdAt: new Date().toISOString() });
        save(all);
        return view(all, e);
      }),
    download: (id, attachmentId) =>
      wait(async () => {
        const a = find(await load(), id).attachments.find((x) => x.id === attachmentId);
        if (!a) throw new ApiError('not_found', 404);
        return { blob: new Blob([Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0))], { type: a.contentType }), filename: a.fileName };
      }),
    detach: (id, attachmentId) =>
      wait(async () => {
        guard('journals.create');
        const all = await load();
        const e = find(all, id);
        if (e.status !== 'draft') throw refuse(409, 'posted');
        e.attachments = e.attachments.filter((x) => x.id !== attachmentId);
        save(all);
      }),
  };
}
