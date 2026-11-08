import type { Organization } from './types';

export interface OrganizationFormValues {
  name: string;
  slug: string;
  ownerEmail: string;
  baseCurrency: string;
  country: string;
  locale: string;
  fiscalYearStartMonth: number;
}

export const emptyOrganization: OrganizationFormValues = { name: '', slug: '', ownerEmail: '', baseCurrency: 'INR', country: 'IN', locale: 'en-IN', fiscalYearStartMonth: 4 };

export const fromOrganization = (o: Organization): OrganizationFormValues => ({
  name: o.name,
  slug: o.slug,
  ownerEmail: '',
  baseCurrency: o.baseCurrency,
  country: o.country ?? '',
  locale: o.locale,
  fiscalYearStartMonth: o.fiscalYearStartMonth,
});

export type FieldErrors = Partial<Record<'name' | 'slug' | 'ownerEmail' | 'baseCurrency' | 'country' | 'locale' | 'fiscalYearStartMonth', string>>;
