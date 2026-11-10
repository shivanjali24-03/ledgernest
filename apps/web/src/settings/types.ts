import type { LogoType, OrganizationSettingsInput } from '@ledgernest/shared';

export interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  baseCurrency: string;
  locale: string;
  timeZone: string;
  country: string | null;
  fiscalYearStartMonth: number;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  /** Printed at the foot of invoices and quotes: payment terms, bank details */
  invoiceTerms?: string | null;
  /** Email Owners and Admins a summary every Monday morning */
  weeklySummary?: boolean;
  address: { line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null };
  logo: { contentType: string; updatedAt: string } | null;
  /** Settings that can no longer change, e.g. the base currency once entries are posted */
  locks: { baseCurrency: boolean; fiscalYearStartMonth: boolean };
}

/** An organisation's settings. Live and demo both implement it. */
export interface SettingsApi {
  get(): Promise<OrganizationSettings>;
  update(input: OrganizationSettingsInput): Promise<OrganizationSettings>;
  setLogo(upload: { type: LogoType; data: string }): Promise<OrganizationSettings>;
  removeLogo(): Promise<void>;
  /** The logo image, or null when there is none */
  logo(): Promise<Blob | null>;
}
