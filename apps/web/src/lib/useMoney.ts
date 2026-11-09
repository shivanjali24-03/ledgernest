import { useCallback } from 'react';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { formatMoney, minorDigits } from './format';

/**
 * Amounts in the organisation's own currency and number format (e.g. ₹1,23,456.00 for en-IN),
 * whatever language the reader uses for the interface.
 */
export function useMoney() {
  const settings = useOrganizationSettings().data;
  const currency = settings?.baseCurrency ?? 'INR';
  const locale = settings?.locale ?? 'en-IN';
  const format = useCallback((minor: number) => formatMoney(minor, currency, locale), [currency, locale]);
  /** Without the currency symbol, for columns of numbers */
  const plain = useCallback((minor: number) => formatMoney(minor, currency, locale, { style: 'decimal' }), [currency, locale]);
  return { currency, locale, digits: minorDigits(currency), format, plain, ready: !!settings };
}
