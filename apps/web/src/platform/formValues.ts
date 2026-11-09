import type { Organization } from './types';

export interface OrganizationFormValues {
  name: string;
  slug: string;
  ownerEmail: string;
  baseCurrency: string;
  country: string;
  locale: string;
  fiscalYearStartMonth: number;
  /** Create only: start with this industry's chart of accounts ('' = start empty) */
  industry: string;
}

export const emptyOrganization: OrganizationFormValues = { name: '', slug: '', ownerEmail: '', baseCurrency: 'INR', country: 'IN', locale: 'en-IN', fiscalYearStartMonth: 4, industry: '' };

export const fromOrganization = (o: Organization): OrganizationFormValues => ({
  name: o.name,
  slug: o.slug,
  ownerEmail: '',
  baseCurrency: o.baseCurrency,
  country: o.country ?? '',
  locale: o.locale,
  fiscalYearStartMonth: o.fiscalYearStartMonth,
  industry: '',
});

export type FieldErrors = Partial<Record<'name' | 'slug' | 'ownerEmail' | 'baseCurrency' | 'country' | 'locale' | 'fiscalYearStartMonth', string>>;
