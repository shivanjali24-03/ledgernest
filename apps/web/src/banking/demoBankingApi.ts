import { bankMoneySchema, bankTransferSchema, currencyDigits, guessMapping, looksLikeOfx, parseCsv, splitTax, statementFingerprints, statementFromCsv, statementFromOfx, statementImportSchema, statementMappingSchema, todayIn, toBase, type StatementMapping } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoAccountsApi } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { DEMO_BASE_CURRENCY, demoRateOn } from '../currencies/demoCurrenciesApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoReportsApi } from '../reports/demoReportsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import type { BankAccount, BankingApi, BankStatementLine, BankTransaction, BookLine, Reconciliation, StatementImport } from './types';

/** Banking in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.banking';

function load(): BankTransaction[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as BankTransaction[];
  } catch {
    /* fall through */
  }
  return [];
}
function save(rows: BankTransaction[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
/** Statements in demo mode: imports, their lines, and each account's CSV layout */
const STATEMENTS = 'ledgernest.demo.statements';
type Statements = { imports: (StatementImport & { bankAccountId: string })[]; lines: (BankStatementLine & { bankAccountId: string; fingerprint: string })[]; layouts: Record<string, StatementMapping>; matches?: Record<string, { journalLineIds: string[]; reconciliationId: string | null }>; reconciliations?: Reconciliation[] };
function loadStatements(): Statements {
  try {
    const raw = localStorage.getItem(STATEMENTS);
    if (raw) return JSON.parse(raw) as Statements;
  } catch {
    /* fall through */
  }
  return { imports: [], lines: [], layouts: {} };
}
function saveStatements(s: Statements) {
  try {
    localStorage.setItem(STATEMENTS, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoBanking = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(STATEMENTS);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const today = () => todayIn('Asia/Kolkata');

export function createDemoBankingApi(canManage: () => boolean): BankingApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['banking.manage'] });
  };
  const accountsApi = createDemoAccountsApi(() => true);
  const reports = createDemoReportsApi(() => true);
  const journals = () => createDemoJournalsApi(() => true);
  const bankOf = async (id: string, field: string) => {
    const a = (await accountsApi.list(true)).find((x) => x.id === id);
    if (!a || a.type !== 'asset' || (a.subtype !== 'bank' && a.subtype !== 'cash')) throw refuse(400, 'bank_invalid', { field });
    if (a.archived) throw refuse(400, 'account_archived', { field });
    return a;
  };
  const post = async (input: Parameters<ReturnType<typeof createDemoJournalsApi>['create']>[0]) => {
    const j = journals();
    const draft = await j.create(input);
    return j.post(draft.id).catch(async (e: unknown) => {
      await j.remove(draft.id);
      throw e;
    });
  };
  const ref = (a: { id: string; code: string; name: string; currency: string | null }) => ({ id: a.id, code: a.code, name: a.name, currency: a.currency ?? null });
  const inBase = (minor: number, currency: string | null, rate: string | null) => (currency ? toBase(minor, rate!, currencyDigits(currency), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
  const rateFor = (currency: string | null, given: string | null, date: string) => {
    if (!currency) return null;
    const r = given ?? demoRateOn(currency, date);
    if (!r) throw refuse(400, 'no_rate', { currency, date });
    return r;
  };

  /** Reads a statement as the API does: OFX as it is, CSV with the given, saved or guessed layout */
  const readStatement = async (input: unknown) => {
    const p = statementImportSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    const d = p.data;
    const account = await bankOf(d.bankAccountId, 'bankAccountId');
    const digits = currencyDigits(account.currency ?? DEMO_BASE_CURRENCY);
    if (looksLikeOfx(d.content)) return { d, account, format: 'ofx' as const, mapping: null, headers: [] as string[], ...statementFromOfx(d.content, digits) };
    const saved = statementMappingSchema.safeParse(loadStatements().layouts[account.id]);
    const mapping = d.mapping ?? (saved.success ? saved.data : null) ?? guessMapping(d.content);
    if (!mapping) throw refuse(400, 'layout_unknown', { rows: parseCsv(d.content, ',').slice(0, 10) });
    const headers = mapping.headerRows ? (parseCsv(d.content, mapping.delimiter)[mapping.headerRows - 1] ?? []) : [];
    return { d, account, format: 'csv' as const, mapping, headers, ...statementFromCsv(d.content, mapping, digits) };
  };
  /** The account's posted book lines that stand (not reversed, not reversals), in its own currency */
  const bookLines = async (accountId: string, foreign: boolean): Promise<BookLine[]> => {
    const j = journals();
    const { items } = await j.list({ status: 'posted', page: 1, pageSize: 1000 });
    const out: BookLine[] = [];
    for (const e of await Promise.all(items.map((x) => j.get(x.id)))) {
      if (e.reversalOf || e.reversedBy) continue;
      for (const l of e.lines.filter((x) => x.accountId === accountId)) out.push({ id: l.id, entryId: e.id, number: e.number, date: e.date, memo: e.memo, reference: e.reference, description: l.description, amount: foreign ? l.foreignDebit - l.foreignCredit : l.debit - l.credit });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  };
  /** Reversed pairs net to nothing, but count them in the balance all the same (as the books do) */
  const reversedTotal = async (accountId: string, foreign: boolean, date: string) => {
    const j = journals();
    const { items } = await j.list({ status: 'posted', page: 1, pageSize: 1000 });
    let sum = 0;
    for (const e of await Promise.all(items.map((x) => j.get(x.id)))) {
      if (!(e.reversalOf || e.reversedBy) || e.date > date) continue;
      for (const l of e.lines.filter((x) => x.accountId === accountId)) sum += foreign ? l.foreignDebit - l.foreignCredit : l.debit - l.credit;
    }
    return sum;
  };
  const api: BankingApi = {
    previewStatement: (input) =>
      wait(async () => {
        guard();
        const r = await readStatement(input);
        const prints = statementFingerprints(r.lines);
        const have = new Set(loadStatements().lines.filter((l) => l.bankAccountId === r.account.id).map((l) => l.fingerprint));
        const lines = r.lines.map((l, k) => ({ ...l, duplicate: have.has(prints[k]!) }));
        const fresh = lines.filter((l) => !l.duplicate);
        const dates = lines.map((l) => l.date).sort();
        return { format: r.format, mapping: r.mapping, headers: r.headers, currency: r.account.currency ?? null, total: lines.length, duplicates: lines.length - fresh.length, moneyIn: fresh.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0), moneyOut: -fresh.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0), firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, lines: lines.slice(0, 500), issues: r.issues };
      }),
    importStatement: (input) =>
      wait(async () => {
        guard();
        const r = await readStatement(input);
        if (!r.lines.length) throw refuse(400, 'nothing_to_import');
        const st = loadStatements();
        const prints = statementFingerprints(r.lines);
        const have = new Set(st.lines.filter((l) => l.bankAccountId === r.account.id).map((l) => l.fingerprint));
        const fresh = r.lines.map((l, k) => ({ l, print: prints[k]! })).filter((x) => !have.has(x.print));
        const dates = fresh.map((x) => x.l.date).sort();
        const id = crypto.randomUUID();
        st.imports.unshift({ id, bankAccountId: r.account.id, fileName: r.d.fileName, format: r.format, added: fresh.length, duplicates: r.lines.length - fresh.length, rejected: r.issues.length, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, createdAt: new Date().toISOString(), reconciled: 0 });
        st.lines.push(...fresh.map(({ l, print }) => ({ id: crypto.randomUUID(), bankAccountId: r.account.id, importId: id, date: l.date, description: l.description, reference: l.reference, amount: l.amount, balance: l.balance, status: 'unmatched' as const, fingerprint: print })));
        if (r.mapping) st.layouts[r.account.id] = r.mapping;
        saveStatements(st);
        return { id, added: fresh.length, duplicates: r.lines.length - fresh.length, rejected: r.issues.length };
      }),
    statementImports: (bankAccountId) =>
      wait(() => {
        const st = loadStatements();
        return st.imports.filter((i) => i.bankAccountId === bankAccountId).map(({ bankAccountId: _b, ...i }) => ({ ...i, reconciled: st.lines.filter((l) => l.importId === i.id && l.status !== 'unmatched').length }));
      }),
    statementLines: (q) =>
      wait(() => {
        const items = loadStatements()
          .lines.filter((l) => l.bankAccountId === q.bankAccountId && (!q.status || l.status === q.status))
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(({ bankAccountId: _b, fingerprint: _f, ...l }) => l);
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
      }),
    undoImport: (id) =>
      wait(() => {
        guard();
        const st = loadStatements();
        if (!st.imports.some((i) => i.id === id)) throw new ApiError('not_found', 404);
        if (st.lines.some((l) => l.importId === id && l.status !== 'unmatched')) throw refuse(409, 'has_reconciled');
        saveStatements({ ...st, imports: st.imports.filter((i) => i.id !== id), lines: st.lines.filter((l) => l.importId !== id) });
      }),
    accounts: () =>
      wait(async () => {
        const accs = (await accountsApi.list(true)).filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash'));
        const tb = await reports.trialBalance(today());
        const out: BankAccount[] = [];
        for (const a of accs) {
          const row = tb.rows.find((r) => r.accountId === a.id);
          const balance = (row?.debit ?? 0) - (row?.credit ?? 0);
          const ledger = row?.debit || row?.credit ? await reports.ledger(a.id, '1900-01-01', today()) : null;
          const dates = ledger?.rows.map((r) => r.date) ?? [];
          const recent = new Date(Date.parse(`${today()}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
          if (a.archived && !balance) continue;
          out.push({ id: a.id, code: a.code, name: a.name, subtype: a.subtype as 'bank' | 'cash', currency: a.currency, archived: a.archived, hasChildren: a.childCount > 0, balance, foreignBalance: a.currency ? (ledger?.foreign?.closingBalance ?? 0) : null, lastActivity: dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : null, recentMovements: dates.filter((d) => d > recent).length });
        }
        return out;
      }),
    activity: (accountId, from, to) => wait(() => reports.ledger(accountId, from, to)),
    transactions: (q) =>
      wait(() => {
        const items = load()
          .filter((t) => (!q.kind || t.kind === q.kind) && (!q.bankAccountId || t.bankAccount.id === q.bankAccountId || t.toAccount?.id === q.bankAccountId))
          .sort((a, b) => b.date.localeCompare(a.date));
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
      }),
    money: (input) =>
      wait(async () => {
        guard();
        const p = bankMoneySchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const spend = d.kind === 'spend';
        const bank = await bankOf(d.bankAccountId, 'bankAccountId');
        const all = await accountsApi.list(true);
        d.lines.forEach((l, n) => {
          const a = all.find((x) => x.id === l.accountId);
          if (!a) throw refuse(400, 'account_not_found', { line: n + 1 });
          if (a.id === bank.id) throw refuse(400, 'same_account', { line: n + 1 });
          if (a.archived) throw refuse(400, 'account_archived', { line: n + 1 });
          if (a.subtype === 'accounts_receivable' || a.subtype === 'accounts_payable') throw refuse(400, 'use_documents', { line: n + 1 });
        });
        if (bank.currency && d.lines.some((l) => l.taxGroupId)) throw refuse(400, 'tax_foreign');
        const tax = demoTaxState();
        const gross = (l: (typeof d.lines)[number]) => {
          const g = tax.groups.find((x) => x.id === l.taxGroupId);
          if (!g || d.taxInclusive) return l.amount;
          return l.amount + splitTax(l.amount, false, g.rateIds.map((rid) => ({ rateId: rid, ratePpm: tax.rates.find((r) => r.id === rid)!.ratePpm }))).taxes.reduce((s, t) => s + t.amount, 0);
        };
        const total = d.lines.reduce((s, l) => s + gross(l), 0);
        const rate = rateFor(bank.currency, d.rate, d.date);
        const memo = d.description ?? (spend ? 'Money spent' : 'Money received');
        const side = (minor: number, debit: boolean) => (debit ? { debit: minor } : { credit: minor });
        const lines = d.lines.map((l) => ({ accountId: l.accountId, description: l.description ?? memo, ...side(inBase(l.amount, bank.currency, rate), spend), taxGroupId: l.taxGroupId, taxInclusive: !!l.taxGroupId && d.taxInclusive, costCentreId: l.costCentreId ?? null }));
        const bankLine = bank.currency ? { accountId: bank.id, description: memo, currency: bank.currency, rate: rate!, ...(spend ? { foreignCredit: total } : { foreignDebit: total }) } : { accountId: bank.id, description: memo, ...side(total, !spend) };
        const entry = await post({ date: d.date, memo, reference: d.reference, lines: spend ? [...lines, bankLine] : [bankLine, ...lines] });
        const contact = d.contactId ? demoContactRows().find((c) => c.id === d.contactId) : undefined;
        const t: BankTransaction = { id: crypto.randomUUID(), kind: d.kind, status: 'posted', date: d.date, reference: d.reference, description: d.description, bankAccount: ref(bank), toAccount: null, contact: contact ? { id: contact.id, name: contact.name } : null, currency: bank.currency, amount: total, toCurrency: null, toAmount: null, rate, taxInclusive: d.taxInclusive, lines: d.lines, journalEntry: { id: entry.id, number: entry.number }, voidEntry: null };
        save([...load(), t]);
        return t;
      }),
    transfer: (input) =>
      wait(async () => {
        guard();
        const p = bankTransferSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const from = await bankOf(d.fromAccountId, 'fromAccountId');
        const to = await bankOf(d.toAccountId, 'toAccountId');
        const same = (from.currency ?? null) === (to.currency ?? null);
        if (!same && !d.toAmount) throw refuse(400, 'to_amount_required', { field: 'toAmount' });
        if (same && d.toAmount !== null && d.toAmount !== d.amount) throw refuse(400, 'to_amount_differs', { field: 'toAmount' });
        const toAmount = same ? d.amount : d.toAmount!;
        const fromRate = rateFor(from.currency, d.fromRate, d.date);
        const toRate = same ? fromRate : rateFor(to.currency, d.toRate, d.date);
        const memo = d.description ?? `Transfer ${from.code} → ${to.code}`;
        const leg = (a: typeof from, minor: number, rate: string | null, debit: boolean) => (a.currency ? { accountId: a.id, description: memo, currency: a.currency, rate: rate!, ...(debit ? { foreignDebit: minor } : { foreignCredit: minor }) } : { accountId: a.id, description: memo, ...(debit ? { debit: minor } : { credit: minor }) });
        const diff = inBase(d.amount, from.currency, fromRate) - inBase(toAmount, to.currency, toRate);
        const fx = diff ? (await accountsApi.list(true)).find((a) => a.code === '4950' || /exchange/i.test(a.name)) : undefined;
        if (diff && !fx) throw refuse(409, 'no_fx_account');
        const entry = await post({ date: d.date, memo, reference: d.reference, lines: [leg(to, toAmount, toRate, true), leg(from, d.amount, fromRate, false), ...(diff ? [{ accountId: fx!.id, description: `${memo}: exchange difference`, ...(diff > 0 ? { debit: diff } : { credit: -diff }) }] : [])] });
        const units = (minor: number, c: string | null) => minor / 10 ** currencyDigits(c ?? DEMO_BASE_CURRENCY);
        const cross = same ? null : String(Number((!from.currency ? units(d.amount, null) / units(toAmount, to.currency) : units(toAmount, to.currency) / units(d.amount, from.currency)).toFixed(6)));
        const t: BankTransaction = { id: crypto.randomUUID(), kind: 'transfer', status: 'posted', date: d.date, reference: d.reference, description: d.description, bankAccount: ref(from), toAccount: ref(to), contact: null, currency: from.currency, amount: d.amount, toCurrency: to.currency, toAmount, rate: cross, taxInclusive: false, lines: [], journalEntry: { id: entry.id, number: entry.number }, voidEntry: null };
        save([...load(), t]);
        return t;
      }),
    void: (id, reason) =>
      wait(async () => {
        guard();
        const all = load();
        const t = all.find((x) => x.id === id);
        if (!t) throw new ApiError('not_found', 404);
        if (t.status === 'void') throw refuse(409, 'already_void');
        const r = await journals().reverse(t.journalEntry.id, { date: today(), memo: `${t.description ?? 'Bank transaction'} voided${reason ? `: ${reason}` : ''}` });
        Object.assign(t, { status: 'void', voidEntry: { id: r.id, number: r.number } });
        save(all);
        return t;
      }),
    reconcileWorkspace: (accountId, date) =>
      wait(async () => {
        const account = await bankOf(accountId, 'accountId');
        const foreign = !!account.currency;
        const st = loadStatements();
        const matches = st.matches ?? {};
        const book = await bookLines(account.id, foreign);
        const matchedIds = new Set(Object.values(matches).flatMap((m) => m.journalLineIds));
        const free = book.filter((b) => !matchedIds.has(b.id));
        const mine = st.lines.filter((l) => l.bankAccountId === account.id);
        const bankLines = mine.filter((l) => l.status === 'unmatched').sort((a, b) => a.date.localeCompare(b.date)).map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amount: l.amount, balance: l.balance }));
        const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
        const used = new Set<string>();
        const suggestions = bankLines.flatMap((s) => {
          const c = free.filter((b) => !used.has(b.id) && b.amount === s.amount && dayGap(b.date, s.date) <= 10).sort((x, y) => dayGap(x.date, s.date) - dayGap(y.date, s.date))[0];
          if (!c) return [];
          used.add(c.id);
          return [{ statementLineId: s.id, journalLineIds: [c.id], confidence: dayGap(c.date, s.date) <= 3 ? ('high' as const) : ('medium' as const) }];
        });
        const since = mine.length ? mine.map((l) => l.date).sort()[0]! : null;
        const bookBalance = book.filter((b) => b.date <= date).reduce((s, b) => s + b.amount, 0) + (await reversedTotal(account.id, foreign, date));
        const outstanding = since ? free.filter((b) => b.date >= since && b.date <= date) : [];
        const outstandingIn = outstanding.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0);
        const outstandingOut = -outstanding.filter((b) => b.amount < 0).reduce((s, b) => s + b.amount, 0);
        const printed = mine.filter((l) => l.date <= date && l.balance !== null).sort((a, b) => b.date.localeCompare(a.date))[0];
        const recs = (st.reconciliations ?? []).filter((r) => r.bankAccountId === account.id).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
        return {
          account: { id: account.id, code: account.code, name: account.name, currency: account.currency ?? null },
          date,
          bankLines,
          bookLines: free,
          suggestions,
          matched: mine.filter((l) => l.status === 'matched' && !matches[l.id]?.reconciliationId).map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amount: l.amount, bookLines: book.filter((b) => matches[l.id]?.journalLineIds.includes(b.id)) })),
          ignored: mine.filter((l) => l.status === 'ignored').map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amount: l.amount })),
          summary: { bookBalance, outstandingIn, outstandingOut, cleared: bookBalance - outstandingIn + outstandingOut, since, unmatchedToDate: bankLines.filter((l) => l.date <= date).length, statementBalance: printed?.balance ?? null },
          lastReconciliation: recs[0] ? { id: recs[0].id, statementDate: recs[0].statementDate, statementBalance: recs[0].statementBalance, createdAt: recs[0].createdAt } : null,
        };
      }),
    match: (statementLineId, journalLineIds) =>
      wait(async () => {
        guard();
        const st = loadStatements();
        const line = st.lines.find((l) => l.id === statementLineId);
        if (!line) throw new ApiError('not_found', 404);
        if (line.status !== 'unmatched') throw refuse(409, 'line_not_unmatched');
        const account = await bankOf(line.bankAccountId, 'bankAccountId');
        const book = await bookLines(account.id, !!account.currency);
        const taken = new Set(Object.values(st.matches ?? {}).flatMap((m) => m.journalLineIds));
        const chosen = journalLineIds.map((id) => book.find((b) => b.id === id));
        if (chosen.some((b) => !b)) throw refuse(400, 'book_line_not_found');
        if (chosen.some((b) => taken.has(b!.id))) throw refuse(409, 'book_line_matched');
        if (chosen.reduce((s, b) => s + b!.amount, 0) !== line.amount) throw refuse(400, 'amounts_differ');
        line.status = 'matched';
        st.matches = { ...(st.matches ?? {}), [line.id]: { journalLineIds, reconciliationId: null } };
        saveStatements(st);
      }),
    unmatch: (statementLineId) =>
      wait(() => {
        guard();
        const st = loadStatements();
        const line = st.lines.find((l) => l.id === statementLineId);
        if (!line) throw new ApiError('not_found', 404);
        if (line.status !== 'matched') throw refuse(409, 'line_not_matched');
        if (st.matches?.[line.id]?.reconciliationId) throw refuse(409, 'reconciled');
        line.status = 'unmatched';
        delete st.matches?.[line.id];
        saveStatements(st);
      }),
    ignore: (statementLineId, ignored) =>
      wait(() => {
        guard();
        const st = loadStatements();
        const line = st.lines.find((l) => l.id === statementLineId);
        if (!line) throw new ApiError('not_found', 404);
        if (line.status === 'matched') throw refuse(409, 'line_matched');
        line.status = ignored ? 'ignored' : 'unmatched';
        saveStatements(st);
      }),
    createFromLine: async (input) => {
      const line = loadStatements().lines.find((l) => l.id === input.statementLineId);
      if (!line) throw new ApiError('not_found', 404);
      if (line.status !== 'unmatched') throw refuse(409, 'line_not_unmatched');
      const t = await api.money({ kind: line.amount < 0 ? 'spend' : 'receive', bankAccountId: line.bankAccountId, date: line.date, reference: line.reference, description: input.description ?? line.description, taxInclusive: !!input.taxGroupId, lines: [{ accountId: input.accountId, amount: Math.abs(line.amount), taxGroupId: input.taxGroupId }] });
      const entry = await journals().get(t.journalEntry.id);
      await api.match(line.id, [entry.lines.find((l) => l.accountId === line.bankAccountId)!.id]);
      return t;
    },
    reconcile: (input) =>
      wait(async () => {
        guard();
        const st = loadStatements();
        const recs = (st.reconciliations ?? []).filter((r) => r.bankAccountId === input.bankAccountId);
        if (recs.some((r) => r.statementDate >= input.statementDate)) throw refuse(400, 'before_last');
        const ws = await api.reconcileWorkspace(input.bankAccountId, input.statementDate);
        if (ws.summary.unmatchedToDate) throw refuse(409, 'unmatched_lines', { count: ws.summary.unmatchedToDate });
        if (ws.summary.cleared !== input.statementBalance) throw refuse(409, 'difference', { difference: input.statementBalance - ws.summary.cleared });
        const fresh = loadStatements();
        const r: Reconciliation = { id: crypto.randomUUID(), bankAccountId: input.bankAccountId, statementDate: input.statementDate, statementBalance: input.statementBalance, bookBalance: ws.summary.bookBalance, outstandingIn: ws.summary.outstandingIn, outstandingOut: ws.summary.outstandingOut, matches: 0, createdAt: new Date().toISOString() };
        for (const l of fresh.lines.filter((x) => x.bankAccountId === input.bankAccountId && x.status === 'matched' && x.date <= input.statementDate)) {
          const m = fresh.matches?.[l.id];
          if (m && !m.reconciliationId) {
            m.reconciliationId = r.id;
            r.matches += m.journalLineIds.length;
          }
        }
        fresh.reconciliations = [...(fresh.reconciliations ?? []), r];
        saveStatements(fresh);
        return r;
      }),
    reconciliations: (bankAccountId) => wait(() => (loadStatements().reconciliations ?? []).filter((r) => r.bankAccountId === bankAccountId).sort((a, b) => b.statementDate.localeCompare(a.statementDate))),
    undoReconciliation: (id) =>
      wait(() => {
        guard();
        const st = loadStatements();
        const r = (st.reconciliations ?? []).find((x) => x.id === id);
        if (!r) throw new ApiError('not_found', 404);
        if ((st.reconciliations ?? []).some((x) => x.bankAccountId === r.bankAccountId && x.statementDate > r.statementDate)) throw refuse(409, 'not_latest');
        for (const m of Object.values(st.matches ?? {})) if (m.reconciliationId === id) m.reconciliationId = null;
        st.reconciliations = (st.reconciliations ?? []).filter((x) => x.id !== id);
        saveStatements(st);
      }),
  };
  return api;
}
