import { fiscalYearName, fiscalYearOf, fiscalYearSpan, todayIn } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import type { FiscalPeriod, FiscalYearsResponse, PeriodsApi } from './types';

/**
 * Financial years in demo mode for the sample company (April–March, India).
 * Last year and this one exist, with every month before last month closed, as a real business would have.
 */
const KEY = 'ledgernest.demo.periods';
const START_MONTH = 4;
type StoredPeriod = { id: string; yearId: string; number: number; startDate: string; endDate: string; status: 'open' | 'closed'; closedAt: string | null; closeReason: string | null };
type StoredYear = { id: string; name: string; startDate: string; endDate: string; startYear: number; closingEntryId?: string | null };
type State = { years: StoredYear[]; periods: StoredPeriod[] };

const today = () => todayIn('Asia/Kolkata');
function addYear(s: State, startYear: number) {
  const span = fiscalYearSpan(startYear, START_MONTH);
  const yearId = crypto.randomUUID();
  s.years.push({ id: yearId, name: fiscalYearName(startYear, START_MONTH), startDate: span.startDate, endDate: span.endDate, startYear });
  for (const p of span.periods) s.periods.push({ id: crypto.randomUUID(), yearId, ...p, status: 'open', closedAt: null, closeReason: null });
  return s.years[s.years.length - 1]!;
}
function seed(): State {
  const s: State = { years: [], periods: [] };
  const current = fiscalYearOf(today(), START_MONTH);
  addYear(s, current - 1);
  addYear(s, current);
  // Months that ended more than a month ago are closed
  const cutoff = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  for (const p of s.periods) if (new Date(`${p.endDate}T00:00:00Z`) < cutoff) Object.assign(p, { status: 'closed', closedAt: `${p.endDate}T18:00:00Z` });
  return s;
}
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  // Saved straight away: the sample has random ids, which must stay the same between reads
  const s = seed();
  save(s);
  return s;
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoPeriods = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** Entries that closed a year, which can't be reversed by hand (the demo journals check this) */
export const demoClosingEntryIds = () => load().years.map((y) => y.closingEntryId).filter((x): x is string => !!x);

const refuse = (status: 400 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

export function createDemoPeriodsApi(can: (permission: 'periods.close' | 'periods.reopen') => boolean): PeriodsApi {
  // Created when needed: the demo journals use the demo periods too
  const journals = () => createDemoJournalsApi(() => true);
  const guard = (p: 'periods.close' | 'periods.reopen') => {
    if (!can(p)) throw new ApiError('forbidden', 403, undefined, undefined, { missing: [p] });
  };
  return {
    list: () =>
      wait(async (): Promise<FiscalYearsResponse> => {
        const s = load();
        const numbers = new Map(await Promise.all(s.years.filter((y) => y.closingEntryId).map(async (y) => [y.id, await journals().numberOf(y.closingEntryId!)] as const)));
        const t = today();
        const sorted = [...s.periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
        const firstOpen = sorted.find((p) => p.status === 'open');
        const lastClosed = [...sorted].reverse().find((p) => p.status === 'closed');
        const years = [...s.years].sort((a, b) => b.startDate.localeCompare(a.startDate));
        return {
          today: t,
          fiscalYearStartMonth: START_MONTH,
          next: years.length ? years[0]!.startYear + 1 : fiscalYearOf(t, START_MONTH),
          previous: years.length ? years[years.length - 1]!.startYear - 1 : null,
          years: years.map((y) => {
            const periods = sorted.filter((p) => p.yearId === y.id);
            return {
              id: y.id,
              name: y.name,
              startDate: y.startDate,
              endDate: y.endDate,
              current: y.startDate <= t && t <= y.endDate,
              closed: periods.every((p) => p.status === 'closed'),
              closingEntry: y.closingEntryId ? { id: y.closingEntryId, number: numbers.get(y.id) ?? '' } : null,
              periods: periods.map(
                (p): FiscalPeriod => ({
                  id: p.id,
                  number: p.number,
                  startDate: p.startDate,
                  endDate: p.endDate,
                  status: p.status,
                  closedAt: p.closedAt,
                  closedBy: p.status === 'closed' ? { name: 'Priya Nair', email: 'priya@nestdemo.in' } : null,
                  closeReason: p.closeReason,
                  current: p.startDate <= t && t <= p.endDate,
                  canClose: p.id === firstOpen?.id,
                  canReopen: p.id === lastClosed?.id,
                }),
              ),
            };
          }),
        };
      }),
    yearEnd: (yearId) =>
      wait(async () => {
        const y = load().years.find((x) => x.id === yearId);
        if (!y) throw new ApiError('not_found', 404);
        const { lines, profit } = await journals().yearEnd(y.startDate, y.endDate);
        return { name: y.name, profit, accounts: lines.length };
      }),
    createYear: (startYear) =>
      wait(() => {
        guard('periods.close');
        const s = load();
        const years = [...s.years].sort((a, b) => a.startYear - b.startYear);
        if (years.some((y) => y.startYear === startYear)) throw refuse(409, 'exists');
        if (years.length && startYear !== years[0]!.startYear - 1 && startYear !== years[years.length - 1]!.startYear + 1) throw refuse(400, 'not_contiguous');
        const y = addYear(s, startYear);
        save(s);
        return { id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate };
      }),
    close: (id, reason) =>
      wait(async () => {
        guard('periods.close');
        const s = load();
        const p = s.periods.find((x) => x.id === id);
        if (!p) throw new ApiError('not_found', 404);
        if (p.status === 'closed') throw refuse(409, 'already_closed');
        if (s.periods.some((x) => x.status === 'open' && x.startDate < p.startDate)) throw refuse(409, 'earlier_open');
        // Closing a year's last month closes the year: its profit moves to retained earnings first
        const year = s.years.find((y) => y.id === p.yearId)!;
        if (p.endDate === year.endDate) year.closingEntryId = await journals().closeYear(year.name, year.startDate, year.endDate);
        Object.assign(p, { status: 'closed', closedAt: new Date().toISOString(), closeReason: reason ?? null });
        save(s);
      }),
    reopen: (id, reason) =>
      wait(async () => {
        guard('periods.reopen');
        const s = load();
        const p = s.periods.find((x) => x.id === id);
        if (!p) throw new ApiError('not_found', 404);
        if (p.status === 'open') throw refuse(409, 'already_open');
        if (s.periods.some((x) => x.status === 'closed' && x.startDate > p.startDate)) throw refuse(409, 'later_closed');
        Object.assign(p, { status: 'open', closedAt: null, closeReason: null });
        void reason; // the demo keeps no audit log of reopen reasons
        save(s);
        // Reopening a closed year's last month reverses its closing entry
        const year = s.years.find((y) => y.id === p.yearId)!;
        if (year.closingEntryId) {
          const entryId = year.closingEntryId;
          year.closingEntryId = null;
          save(s);
          await journals().reopenYear(entryId, year.name, year.endDate);
        }
      }),
  };
}
