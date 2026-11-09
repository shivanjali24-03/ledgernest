import { journalDraftSchema, journalNumber, postingProblem, sniffAttachmentType, todayIn, totals } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoAccountsApi, sampleId } from '../accounts/demoAccountsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import type { JournalEntry, JournalsApi, JournalSummary } from './types';

/**
 * Journal entries in demo mode: a month of realistic entries for the sample company (GST sales,
 * rent, payroll, a corrected card charge) plus a draft. Same rules as the API: balance, open months,
 * active accounts, final posted entries, reversals linked both ways.
 */

const KEY = 'ledgernest.demo.journals';
type StoredLine = { accountId: string; description: string | null; debit: number; credit: number };
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
  const sale = entry(thisMonth(2), 'Invoice INV-1042 · Kumar Logistics', 'INV-1042', [
    ['1300', 11800000, 0],
    ['4100.01', 0, 10000000, 'Software development, sprint 14'],
    ['2200.01', 0, 900000, 'CGST 9%'],
    ['2200.02', 0, 900000, 'SGST 9%'],
  ]);
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
  return [capital, sale, rent, payroll, cloud, fix, cloudRight, receipt];
}

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

export const resetDemoJournals = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

export function createDemoJournalsApi(can: (p: 'journals.create' | 'journals.post' | 'journals.reverse') => boolean): JournalsApi {
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
        return { id: `${e.id}-${i}`, lineNo: i + 1, accountId: l.accountId, account: { code: a?.code ?? '?', name: a?.name ?? '?', type: a?.type ?? 'asset' }, description: l.description, debit: l.debit, credit: l.credit };
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
  const postInto = async (all: Stored[], e: Stored) => {
    const problem = postingProblem(e.lines);
    if (problem) throw refuse(400, problem, totals(e.lines));
    await checkAccounts(e.lines);
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

  return {
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
        await checkAccounts(d.lines);
        const all = await load();
        const e: Stored = { id: crypto.randomUUID(), number: null, yearName: null, date: d.date, memo: d.memo, reference: d.reference, status: 'draft', reversalOfId: null, postedAt: null, createdAt: new Date().toISOString(), lines: d.lines, attachments: [] };
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
        await checkAccounts(d.lines);
        Object.assign(e, { date: d.date, memo: d.memo, reference: d.reference, lines: d.lines });
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
        const r: Stored = {
          id: crypto.randomUUID(),
          number: null,
          yearName: null,
          date: input.date ?? e.date,
          memo: input.memo || `Reversal of ${label(e)}`,
          reference: e.reference,
          status: 'draft',
          reversalOfId: id,
          postedAt: null,
          createdAt: new Date().toISOString(),
          lines: e.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
          attachments: [],
        };
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
