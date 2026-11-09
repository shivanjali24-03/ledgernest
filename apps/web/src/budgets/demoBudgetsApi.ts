import { budgetCreateSchema, compareCodes, favourable, PNL_SECTIONS, pnlSectionOf, yearMonths, type PnlSection } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoCostCentreRef } from '../cost-centres/demoCostCentresApi';
import { createDemoAccountsApi } from '../accounts/demoAccountsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi, demoClosingEntryIds } from '../periods/demoPeriodsApi';
import type { BudgetComparison, BudgetGrid, BudgetsApi, BudgetSummary } from './types';

/** Budgets in demo mode: the same rules as the API, against the demo's posted journals. */
const KEY = 'ledgernest.demo.budgets';
type Stored = { id: string; name: string; fiscalYearId: string; costCentreId?: string | null; updatedAt: string; lines: Record<string, number[]> };

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  return [];
}
function save(s: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoBudgets = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 404 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : status === 404 ? 'not_found' : 'conflict', status, undefined, undefined, { reason });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));
const zeros = () => Array.from({ length: 12 }, () => 0);

export function createDemoBudgetsApi(canManage: () => boolean): BudgetsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['accounts.manage'] });
  };
  const accounts = () => createDemoAccountsApi(() => true).list(true);
  const years = async () => (await createDemoPeriodsApi(() => true).list()).years;
  const year = async (id: string) => {
    const y = (await years()).find((x) => x.id === id);
    if (!y) throw refuse(400, 'year_not_found');
    return y;
  };
  /** Income and expense accounts' actuals per month ("2026-04") between two days, the way they read */
  /** costCentreId: only that cost centre's lines */
  const actuals = async (from: string, to: string, costCentreId: string | null = null) => {
    const j = createDemoJournalsApi(() => true);
    const closing = new Set(demoClosingEntryIds());
    const accs = new Map((await accounts()).map((a) => [a.id, a]));
    const { items } = await j.list({ status: 'posted', page: 1, pageSize: 1000 });
    const out = new Map<string, Map<string, number>>();
    for (const e of items.filter((x) => x.date >= from && x.date <= to && !closing.has(x.id))) {
      for (const l of (await j.get(e.id)).lines.filter((x) => !costCentreId || x.costCentre?.id === costCentreId)) {
        const a = accs.get(l.accountId);
        if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
        const m = out.get(a.id) ?? new Map<string, number>();
        const month = e.date.slice(0, 7);
        m.set(month, (m.get(month) ?? 0) + (a.type === 'income' ? l.credit - l.debit : l.debit - l.credit));
        out.set(a.id, m);
      }
    }
    return out;
  };
  const find = (id: string) => {
    const b = load().find((x) => x.id === id);
    if (!b) throw refuse(404, 'budget_not_found');
    return b;
  };
  const grid = async (b: Stored): Promise<BudgetGrid> => {
    const y = await year(b.fiscalYearId);
    const accs = await accounts();
    const rows = accs
      .filter((a) => (a.type === 'income' || a.type === 'expense') && a.childCount === 0 && (!a.archived || b.lines[a.id]))
      .sort((x, z) => compareCodes(x.code, z.code))
      .map((a) => {
        const amounts = b.lines[a.id] ?? zeros();
        return { accountId: a.id, code: a.code, name: a.name, type: a.type as 'income' | 'expense', section: pnlSectionOf(a.type, a.subtype)!, amounts, total: amounts.reduce((s, v) => s + v, 0) };
      });
    return { id: b.id, name: b.name, costCentre: demoCostCentreRef(b.costCentreId), fiscalYear: { id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate }, months: yearMonths(y.startDate), rows, updatedAt: b.updatedAt };
  };
  const nameTaken = (yearId: string, name: string, except?: string) => load().some((x) => x.fiscalYearId === yearId && x.name === name && x.id !== except);

  return {
    list: () =>
      wait(async () => {
        const accs = new Map((await accounts()).map((a) => [a.id, a.type]));
        const ys = await years();
        return load()
          .map((b): BudgetSummary => {
            const sum = (type: string) => Object.entries(b.lines).reduce((s, [acc, am]) => s + (accs.get(acc) === type ? am.reduce((x, v) => x + v, 0) : 0), 0);
            const y = ys.find((x) => x.id === b.fiscalYearId);
            const income = sum('income');
            const expenses = sum('expense');
            return { id: b.id, name: b.name, fiscalYear: { id: b.fiscalYearId, name: y?.name ?? '' }, costCentre: demoCostCentreRef(b.costCentreId), updatedAt: b.updatedAt, income, expenses, profit: income - expenses };
          })
          .sort((x, y) => y.fiscalYear.name.localeCompare(x.fiscalYear.name) || x.name.localeCompare(y.name));
      }),
    get: (id) => wait(() => grid(find(id))),
    create: (input) =>
      wait(async () => {
        guard();
        const p = budgetCreateSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const y = await year(d.fiscalYearId);
        if (nameTaken(y.id, d.name)) throw refuse(409, 'name_taken');
        const factor = 1 + d.adjustPercent / 100;
        const lines: Record<string, number[]> = {};
        if (d.startFrom === 'actuals') {
          const [sy, sm] = y.startDate.split('-').map(Number) as [number, number];
          const lastStart = `${sy - 1}-${String(sm).padStart(2, '0')}-01`;
          const lastEnd = new Date(Date.parse(`${y.startDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
          const last = yearMonths(lastStart);
          for (const [acc, m] of await actuals(lastStart, lastEnd, d.costCentreId)) lines[acc] = last.map((mm) => Math.round((m.get(mm) ?? 0) * factor));
        } else if (d.startFrom === 'budget') {
          const other = load().find((x) => x.id === d.budgetId);
          if (!other) throw refuse(400, 'budget_not_found');
          for (const [acc, am] of Object.entries(other.lines)) lines[acc] = am.map((v) => Math.round(v * factor));
        }
        const b: Stored = { id: crypto.randomUUID(), name: d.name, fiscalYearId: y.id, costCentreId: d.costCentreId, updatedAt: new Date().toISOString(), lines };
        save([...load(), b]);
        return grid(b);
      }),
    setLines: (id, lines) =>
      wait(async () => {
        guard();
        const b = find(id);
        const accs = new Map((await accounts()).map((a) => [a.id, a.type]));
        if (lines.some((l) => accs.get(l.accountId) !== 'income' && accs.get(l.accountId) !== 'expense')) throw refuse(400, 'not_pnl_account');
        for (const l of lines) b.lines[l.accountId] = l.amounts.map((v) => Math.round(v));
        b.updatedAt = new Date().toISOString();
        save(load().map((x) => (x.id === id ? b : x)));
        return grid(b);
      }),
    rename: (id, name) =>
      wait(async () => {
        guard();
        const b = find(id);
        const n = name.trim();
        if (nameTaken(b.fiscalYearId, n, id)) throw refuse(409, 'name_taken');
        b.name = n;
        save(load().map((x) => (x.id === id ? b : x)));
        return grid(b);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        find(id);
        save(load().filter((x) => x.id !== id));
      }),
    comparison: (id, upTo) =>
      wait(async (): Promise<BudgetComparison> => {
        const g = await grid(find(id));
        const to = upTo && upTo < g.fiscalYear.endDate ? upTo : g.fiscalYear.endDate;
        const count = g.months.filter((m) => m <= to.slice(0, 7)).length;
        const act = await actuals(g.fiscalYear.startDate, to, g.costCentre?.id ?? null);
        const accs = new Map((await accounts()).map((a) => [a.id, a]));
        const base = [...g.rows];
        for (const acc of act.keys()) {
          const a = accs.get(acc);
          if (a && !base.some((r) => r.accountId === acc)) base.push({ accountId: a.id, code: a.code, name: a.name, type: a.type as 'income' | 'expense', section: pnlSectionOf(a.type, a.subtype)!, amounts: zeros(), total: 0 });
        }
        const rows = base
          .map((r) => {
            const budget = r.amounts.slice(0, count).reduce((s, v) => s + v, 0);
            const actual = g.months.slice(0, count).reduce((s, m) => s + (act.get(r.accountId)?.get(m) ?? 0), 0);
            const variance = favourable(r.type, budget, actual);
            return { accountId: r.accountId, code: r.code, name: r.name, type: r.type, section: r.section, budget, actual, variance, percent: budget ? Math.round((variance / Math.abs(budget)) * 1000) / 10 : null };
          })
          .filter((r) => r.budget || r.actual)
          .sort((x, y) => compareCodes(x.code, y.code));
        const incomeSide = (s: PnlSection) => s === 'revenue' || s === 'otherIncome';
        const sections = PNL_SECTIONS.map((section) => {
          const mine = rows.filter((r) => r.section === section);
          const budget = mine.reduce((s, r) => s + r.budget, 0);
          const actual = mine.reduce((s, r) => s + r.actual, 0);
          return { section, rows: mine, budget, actual, variance: favourable(incomeSide(section) ? 'income' : 'expense', budget, actual) };
        });
        const net = (k: 'budget' | 'actual') => sections.reduce((s, x) => s + (incomeSide(x.section) ? 1 : -1) * x[k], 0);
        return { id: g.id, name: g.name, fiscalYear: g.fiscalYear, upTo: to, months: count, sections, netProfit: { budget: net('budget'), actual: net('actual'), variance: net('actual') - net('budget') } };
      }),
  };
}
