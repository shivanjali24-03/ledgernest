import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/**
 * Foreign currencies. The books stay in the organisation's base currency; a foreign amount is converted
 * at the day's exchange rate, "1 unit of the foreign currency = rate units of the base currency".
 * Rates are decimal strings (up to 10 decimals) and conversion is integer-only, so nothing drifts.
 */
export const RATE_DECIMALS = 10;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/** Currencies the runtime knows (ISO 4217), e.g. for a picker. */
export const KNOWN_CURRENCIES: readonly string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('currency');
  } catch {
    return ['AED', 'AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'INR', 'JPY', 'KWD', 'NZD', 'SAR', 'SGD', 'USD', 'ZAR'];
  }
})();
const known = new Set(KNOWN_CURRENCIES);
export const isKnownCurrency = (code: string) => known.has(code);

/** Digits in the smallest unit: INR 2, JPY 0, KWD 3. */
export function currencyDigits(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

const RATE_PATTERN = /^\d{1,9}(\.\d{1,10})?$/;

/** "83.25" → 832500000000n (rate × 10^10); null if it isn't a positive rate. */
export function parseRate(text: string): bigint | null {
  const clean = text.trim();
  if (!RATE_PATTERN.test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(RATE_DECIMALS, '0'));
  return scaled > 0n ? scaled : null;
}

/** 832500000000n → "83.25" */
export function formatRateValue(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const frac = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** A rate as typed or fetched, normalised: "083.2500" → "83.25" */
export const normaliseRate = (text: string) => {
  const r = parseRate(text);
  return r === null ? null : formatRateValue(r);
};

/**
 * A foreign amount in its smallest unit, in the base currency's smallest unit, rounded half away from zero.
 * e.g. USD 100.00 (10000 cents) at 83.25 → ₹8,325.00 (832500 paise); JPY 1000 at 0.56 → ₹560.00.
 */
export function toBase(foreignMinor: number, rate: string, foreignDigits: number, baseDigits: number): number {
  const r = parseRate(rate);
  if (r === null) throw new Error(`Not a rate: ${rate}`);
  const num = BigInt(foreignMinor) * r * 10n ** BigInt(baseDigits);
  const den = RATE_SCALE * 10n ** BigInt(foreignDigits);
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  return Number(sign * ((abs * 2n + den) / (den * 2n)));
}

export const rateSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const r = normaliseRate(String(v));
    if (r === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter a rate above 0, with at most 10 decimals.' });
      return z.NEVER;
    }
    return r;
  });

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCurrency, 'Choose a currency, like USD.');

export const currencyAddSchema = z.object({ code: currencyCodeSchema });
export const rateSetSchema = z.object({ rate: rateSchema });
export const rateFetchSchema = z.object({ date: isoDaySchema.optional() });
export const revalueSchema = z.object({ date: isoDaySchema });
export const rateListQuerySchema = z.object({ from: isoDaySchema.optional(), to: isoDaySchema.optional() });
export type CurrencyAddInput = z.input<typeof currencyAddSchema>;

// ---------- exchange differences ----------

export interface ForeignLineAmounts {
  lineNo: number;
  accountId: string;
  currency: string | null;
  foreignDebit: number;
  foreignCredit: number;
  debit: number;
  credit: number;
}

/** a × b ÷ c, rounded half away from zero */
const mulDiv = (a: bigint, b: bigint, c: bigint) => {
  const n = a * b;
  const neg = n < 0n !== c < 0n;
  const [an, ac] = [n < 0n ? -n : n, c < 0n ? -c : c];
  const q = (an * 2n + ac) / (ac * 2n);
  return neg ? -q : q;
};

/**
 * Realised exchange differences for an entry's foreign lines, given each account's posted balance before it
 * (foreign and base). A foreign account carries its balance at an average rate: a line that reduces the balance
 * takes out the carrying amount of the part it settles, and any difference from the line's own base amount is
 * the realised gain (negative adjust: the account is credited) or loss. Lines are taken in order.
 * Returns, per settling line, the base adjustment to the account (debit positive).
 */
export function realisedDifferences(lines: readonly ForeignLineAmounts[], before: (accountId: string) => { foreign: number; base: number }): { sourceLine: number; accountId: string; currency: string; adjust: number }[] {
  const running = new Map<string, { f: bigint; b: bigint }>();
  const out: { sourceLine: number; accountId: string; currency: string; adjust: number }[] = [];
  for (const l of lines) {
    if (!l.currency) continue;
    let acc = running.get(l.accountId);
    if (!acc) {
      const b = before(l.accountId);
      acc = { f: BigInt(b.foreign), b: BigInt(b.base) };
      running.set(l.accountId, acc);
    }
    const lf = BigInt(l.foreignDebit - l.foreignCredit);
    const lb = BigInt(l.debit - l.credit);
    let adjust = 0n;
    if (acc.f !== 0n && lf !== 0n && acc.f > 0n !== lf > 0n) {
      const settled = (lf < 0n ? -lf : lf) <= (acc.f < 0n ? -acc.f : acc.f) ? lf : -acc.f;
      adjust = mulDiv(acc.b, settled, acc.f) - mulDiv(lb, settled, lf);
    }
    acc.f += lf;
    acc.b += lb + adjust;
    if (adjust !== 0n) out.push({ sourceLine: l.lineNo, accountId: l.accountId, currency: l.currency, adjust: Number(adjust) });
  }
  return out;
}
