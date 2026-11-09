import { currencyDigits, isKnownCurrency, normaliseRate, todayIn } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { CurrenciesApi, CurrenciesResponse, RateView } from './types';

/**
 * Currencies in demo mode. The sample company (base INR) bills export clients in USD and EUR, with a few weeks
 * of European Central Bank rates, and pays a Dubai supplier in AED, which the ECB doesn't cover, so its rate is typed.
 */
const KEY = 'ledgernest.demo.currencies';
const BASE = 'INR';
/** Rates the demo "ECB" publishes, around today's real levels */
const ECB: Record<string, number> = { USD: 93.9, EUR: 105.1, GBP: 122.4, JPY: 0.611, SGD: 72.3, AUD: 61.2, CAD: 67.4, CHF: 112.6 };
type State = { currencies: string[]; rates: Record<string, (RateView & { updatedAt: string })[]> };

const today = () => todayIn('Asia/Kolkata');
const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The last ECB working day on or before a day */
const published = (day: string) => {
  let d = day;
  while (weekday(d) === 0 || weekday(d) === 6) d = shift(d, -1);
  return d;
};
/** A gently moving, repeatable rate for a currency on a day */
const ecbRate = (code: string, day: string) => {
  const n = Number(day.replace(/-/g, '')) % 97;
  return normaliseRate((ECB[code]! * (1 + (n - 48) / 4000)).toFixed(4))!;
};

function seed(): State {
  const rates: State['rates'] = { USD: [], EUR: [], AED: [] };
  for (let i = 0; i < 45; i++) {
    const day = shift(today(), -i);
    if (weekday(day) === 0 || weekday(day) === 6) continue;
    for (const code of ['USD', 'EUR']) rates[code]!.push({ date: day, rate: ecbRate(code, day), source: 'ecb', updatedAt: `${day}T16:30:00Z` });
  }
  rates.AED!.push({ date: shift(today(), -10), rate: '25.57', source: 'manual', updatedAt: `${shift(today(), -10)}T10:00:00Z` });
  return { currencies: ['AED', 'EUR', 'USD'], rates };
}
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  return seed();
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoCurrencies = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** The rate on a day (the latest on or before it), for the demo's journal entries. */
export function demoRateOn(code: string, day: string): string | null {
  return load().rates[code]?.find((r) => r.date <= day)?.rate ?? null;
}
export const demoEnabledCurrencies = () => load().currencies;
export const DEMO_BASE_CURRENCY = BASE;

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const sorted = (rows: State['rates'][string]) => rows.sort((a, b) => b.date.localeCompare(a.date));

/**
 * @param inUse  accounts kept in a currency (from the demo chart), so it can't be removed
 * @param revalue the demo journals' revaluation (kept there, with the rest of the books)
 */
export function createDemoCurrenciesApi(canManage: () => boolean, inUse: (code: string) => number, revalue: CurrenciesApi['revalue']): CurrenciesApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['currencies.manage'] });
  };
  const list = (s: State): CurrenciesResponse => ({
    base: BASE,
    today: today(),
    currencies: [...s.currencies].sort().map((code) => {
      const latest = sorted(s.rates[code] ?? []).find((r) => r.date <= today());
      return { code, digits: currencyDigits(code), rateCount: s.rates[code]?.length ?? 0, latest: latest ? { date: latest.date, rate: latest.rate, source: latest.source } : null };
    }),
  });
  const enabled = (s: State, code: string) => {
    if (!s.currencies.includes(code)) throw new ApiError('not_found', 404);
  };
  return {
    list: () => wait(() => list(load())),
    add: (code) =>
      wait(() => {
        guard();
        const c = code.trim().toUpperCase();
        if (!isKnownCurrency(c)) throw refuse(400, 'invalid');
        const s = load();
        if (c === BASE) throw refuse(409, 'is_base');
        if (s.currencies.includes(c)) throw refuse(409, 'already_enabled');
        s.currencies.push(c);
        s.rates[c] = [];
        save(s);
        return list(s);
      }),
    remove: (code) =>
      wait(() => {
        guard();
        const s = load();
        enabled(s, code);
        if (inUse(code)) throw refuse(409, 'in_use', { accounts: inUse(code) });
        s.currencies = s.currencies.filter((c) => c !== code);
        delete s.rates[code];
        save(s);
      }),
    rates: (code) =>
      wait(() => {
        const s = load();
        enabled(s, code);
        return sorted([...(s.rates[code] ?? [])]);
      }),
    setRate: (code, date, rate) =>
      wait(() => {
        guard();
        const r = normaliseRate(rate);
        if (!r) throw refuse(400, 'invalid');
        const s = load();
        enabled(s, code);
        const rows = (s.rates[code] ??= []);
        const existing = rows.find((x) => x.date === date);
        if (existing) Object.assign(existing, { rate: r, source: 'manual', updatedAt: new Date().toISOString() });
        else rows.push({ date, rate: r, source: 'manual', updatedAt: new Date().toISOString() });
        save(s);
        return { date, rate: r, source: 'manual' as const };
      }),
    removeRate: (code, date) =>
      wait(() => {
        guard();
        const s = load();
        enabled(s, code);
        if (!s.rates[code]?.some((x) => x.date === date)) throw new ApiError('not_found', 404);
        s.rates[code] = s.rates[code]!.filter((x) => x.date !== date);
        save(s);
      }),
    fetchRates: (date) =>
      wait(() => {
        guard();
        const s = load();
        if (!s.currencies.length) throw refuse(409, 'no_currencies');
        const day = published(date ?? today());
        const result = { saved: [] as { code: string; date: string; rate: string }[], keptManual: [] as string[], unsupported: [] as string[], failed: 0 };
        for (const code of [...s.currencies].sort()) {
          if (!(code in ECB)) {
            result.unsupported.push(code);
            continue;
          }
          const rows = (s.rates[code] ??= []);
          const existing = rows.find((x) => x.date === day);
          if (existing?.source === 'manual') {
            result.keptManual.push(code);
            continue;
          }
          const rate = ecbRate(code, day);
          if (existing) Object.assign(existing, { rate, source: 'ecb', updatedAt: new Date().toISOString() });
          else rows.push({ date: day, rate, source: 'ecb', updatedAt: new Date().toISOString() });
          result.saved.push({ code, date: day, rate });
        }
        save(s);
        return result;
      }),
    revalue: (date) => revalue(date),
  };
}
