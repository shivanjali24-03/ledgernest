/**
 * Money is stored as integers in the smallest currency unit (e.g. paise, cents),
 * so amounts never suffer floating-point rounding errors. These helpers format
 * those integers for display in the user's locale.
 */
const DIGITS: Record<string, number> = { JPY: 0, KWD: 3, BHD: 3 };
export const minorDigits = (currency: string) => DIGITS[currency] ?? 2;

export function formatMoney(minor: number, currency = 'INR', locale = 'en-IN', opts: Intl.NumberFormatOptions = {}): string {
  const digits = minorDigits(currency);
  // The minimum can never exceed the maximum (compact formats ask for at most 1 decimal)
  const max = opts.maximumFractionDigits ?? digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Math.min(digits, max),
    maximumFractionDigits: max,
    ...opts,
  }).format(minor / 10 ** digits);
}

/** Short form for dashboards: ₹12.4L, $3.2M */
export const formatCompactMoney = (minor: number, currency = 'INR', locale = 'en-IN') =>
  formatMoney(minor, currency, locale, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });

export const formatPercent = (value: number, locale = 'en-IN') =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);

/** "8 Nov 2026" in the user's language. */
export const formatDate = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** "3 days ago", "in 5 days", "now", in the user's language. */
export function formatRelative(iso: string, locale: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of units) if (Math.abs(diff) >= seconds) return rtf.format(Math.round(diff / seconds), unit);
  return rtf.format(0, 'second');
}

/** Country name from its ISO code, e.g. IN → "India" / "भारत". */
export const countryName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Currency name from its ISO code, e.g. INR → "Indian Rupee". */
export const currencyName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Month name, 1 = January. */
export const monthName = (month: number, locale: string) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 1)));
