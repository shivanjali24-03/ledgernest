import { COMMON_CURRENCIES } from '@ledgernest/shared';
import { countryName, currencyName, monthName } from '../lib/format';

/** Choices for organisation forms, named in the user's language by Intl. */
export const COUNTRIES = ['IN', 'US', 'GB', 'AE', 'SA', 'SG', 'AU', 'CA', 'DE', 'FR', 'ES', 'JP'] as const;
/** LedgerNest is for Indian businesses: Indian number and date formats only (an organisation's own setting is kept) */
export const LOCALES = ['en-IN', 'hi-IN', 'mr-IN'] as const;

/** Books are kept in rupees; another base currency only shows when an organisation already has it */
export const baseCurrencyOptions = (locale: string, current?: string) => currencyOptions(locale, current).filter((o) => o.value === 'INR' || o.value === current);

export const currencyOptions = (locale: string, current?: string) =>
  [...new Set([...COMMON_CURRENCIES, ...(current ? [current] : [])])].map((c) => ({ value: c, label: `${c} · ${currencyName(c, locale)}` }));

export const countryOptions = (locale: string, none: string) => [
  { value: '', label: none },
  ...COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale)),
];

export const monthOptions = (locale: string) => Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1, locale) }));

export const localeOptions = (locale: string, current?: string) =>
  [...new Set<string>([...LOCALES, ...(current ? [current] : [])])].map((l) => {
    let label: string = l;
    try {
      label = new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
    } catch {
      /* keep the code */
    }
    return { value: l, label };
  });

/** Translation key for an audit action, e.g. platform.organization.create → platform.activity.platform_organization_create */
export const activityKey = (action: string) => `platform.activity.${action.replace(/\./g, '_')}`;
