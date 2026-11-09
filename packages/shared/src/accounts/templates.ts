import type { AccountSubtype, AccountType } from './index.js';
import { BASE_TEMPLATE, INDUSTRY_EXTRAS, TEMPLATE_ACCOUNT_NAMES } from './templates.data.js';

/** Industries with a ready-made chart of accounts. */
export const INDUSTRIES = ['retail', 'services', 'manufacturing', 'healthcare', 'education', 'nonprofit', 'construction', 'restaurant', 'it_software', 'agriculture'] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** The languages LedgerNest speaks; every template account has a name in each. */
export const TEMPLATE_LANGUAGES = ['en', 'hi', 'mr', 'es', 'fr', 'de', 'ar'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

export interface TemplateAccount {
  /** Key into TEMPLATE_ACCOUNT_NAMES */
  key: string;
  code: string;
  type: AccountType;
  subtype: AccountSubtype;
  /** Code of the parent account in the same template */
  parent?: string;
}

/** A template's accounts, parents before children, named in a language. */
export interface TemplateAccountView extends Omit<TemplateAccount, 'key'> {
  name: string;
}

/** Every account an industry's template creates: the shared base plus that industry's own accounts. */
export function templateAccounts(industry: Industry): TemplateAccount[] {
  return [...BASE_TEMPLATE, ...INDUSTRY_EXTRAS[industry]];
}

/** "hi-IN" → "hi"; anything unknown → "en". */
export const templateLanguage = (locale: string): TemplateLanguage => {
  const l = locale.split('-')[0] as TemplateLanguage;
  return (TEMPLATE_LANGUAGES as readonly string[]).includes(l) ? l : 'en';
};

/** A template ready to show or apply, with names in the organisation's language and parents first. */
export function namedTemplate(industry: Industry, locale: string): TemplateAccountView[] {
  const lang = templateLanguage(locale);
  const depth = (a: TemplateAccount, all: TemplateAccount[]): number => (a.parent ? 1 + depth(all.find((p) => p.code === a.parent)!, all) : 0);
  const all = templateAccounts(industry);
  return all
    .map((a) => ({ code: a.code, type: a.type, subtype: a.subtype, parent: a.parent, name: TEMPLATE_ACCOUNT_NAMES[a.key]![lang], depth: depth(a, all) }))
    .sort((x, y) => x.depth - y.depth)
    .map(({ depth: _d, ...a }) => a);
}

export { BASE_TEMPLATE, INDUSTRY_EXTRAS, TEMPLATE_ACCOUNT_NAMES };
