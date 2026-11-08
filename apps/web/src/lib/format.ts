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
  formatMoney(minor, currency, locale, { notation: 'compact', maximumFractionDigits: 1 });

export const formatPercent = (value: number, locale = 'en-IN') =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);
