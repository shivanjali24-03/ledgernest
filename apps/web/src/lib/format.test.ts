import { countryName, currencyName, formatCompactMoney, formatMoney, formatPercent, formatRelative, minorDigits, monthName } from './format';

// Intl uses non-breaking spaces (e.g. "5,00 €"); compare with normal spaces
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('money formatting', () => {
  it('formats integer minor units in the locale', () => {
    expect(formatMoney(123456789, 'INR', 'en-IN')).toBe('₹12,34,567.89');
    expect(formatMoney(123456789, 'USD', 'en-US')).toBe('$1,234,567.89');
    expect(plain(formatMoney(-500, 'EUR', 'de-DE'))).toBe('-5,00 €');
  });

  it('knows currencies without or with three decimals', () => {
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });

  it('formats compact amounts for dashboards', () => {
    expect(formatCompactMoney(123456789, 'USD', 'en-US')).toBe('$1.2M');
    expect(formatCompactMoney(4821500000, 'INR', 'en-IN')).toBe('₹4.8Cr');
    // Nothing yet reads ₹0, not ₹0.0
    expect(formatCompactMoney(0, 'INR', 'en-IN')).toBe('₹0');
  });

  it('formats percentages with a sign', () => {
    expect(formatPercent(0.125, 'en-US')).toBe('+12.5%');
    expect(formatPercent(-0.04, 'en-US')).toBe('-4%');
  });
});

describe('dates and names', () => {
  it('formats relative time in the user language', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(formatRelative('2026-11-05T12:00:00Z', 'en', now)).toBe('3 days ago');
    expect(formatRelative('2026-11-15T12:00:00Z', 'en', now)).toBe('next week');
    expect(formatRelative('2026-11-08T11:59:30Z', 'en', now)).toBe('now');
  });

  it('names countries, currencies and months via Intl', () => {
    expect(countryName('IN', 'en')).toBe('India');
    expect(currencyName('INR', 'en')).toBe('Indian Rupee');
    expect(monthName(4, 'en')).toBe('April');
    expect(monthName(1, 'fr')).toBe('janvier');
  });
});
