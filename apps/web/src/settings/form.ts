import { LOGO_MAX_BYTES, LOGO_TYPES, sniffLogoType, type LogoType, type OrganizationSettingsInput } from '@ledgernest/shared';
import { monthName } from '../lib/format';
import type { OrganizationSettings } from './types';
import { bankValue } from '../bank/form';

const BANK: string[] = ['bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName', 'bankBranch'];

export interface SettingsValues {
  name: string;
  legalName: string;
  taxId: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  baseCurrency: string;
  locale: string;
  timeZone: string;
  fiscalYearStartMonth: string;
  invoiceTerms: string;
  upiId: string;
  /** 'true' or 'false' (form values are strings) */
  weeklySummary: string;
  /** 'true' or 'false' */
  requireTwoFactor: string;
  msmeCategory: string;
  udyamNumber: string;
  /** The bank rate as a percentage, like 5.50 */
  msmeBankRate: string;
  gstScheme: string;
  /** '100', '500' or '600' (basis points) */
  compositionRate: string;
  /** Interest on late payment as a yearly percentage, like 18; blank = none */
  interestRate: string;
  interestMethod: string;
  interestGraceDays: string;
  /** 'true' or 'false' */
  interestAutoRaise: string;
  /** 'true' or 'false' */
  roundInvoiceTotals: string;
  lutNumber: string;
  lutFrom: string;
  lutTo: string;
  businessType: string;
  pan: string;
  tan: string;
  cin: string;
  iec: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  bankBranch: string;
  signatoryName: string;
  signatoryDesignation: string;
}
export type SettingsField = keyof SettingsValues;
export type SettingsErrors = Partial<Record<SettingsField, string>>;

const ADDRESS = { line1: 'line1', line2: 'line2', city: 'city', region: 'region', postalCode: 'postalCode' } as const;

export const toValues = (s: OrganizationSettings): SettingsValues => ({
  name: s.name,
  legalName: s.legalName ?? '',
  taxId: s.taxId ?? '',
  email: s.email ?? '',
  phone: s.phone ?? '',
  line1: s.address.line1 ?? '',
  line2: s.address.line2 ?? '',
  city: s.address.city ?? '',
  region: s.address.region ?? '',
  postalCode: s.address.postalCode ?? '',
  country: s.country ?? '',
  baseCurrency: s.baseCurrency,
  locale: s.locale,
  timeZone: s.timeZone,
  fiscalYearStartMonth: String(s.fiscalYearStartMonth),
  invoiceTerms: s.invoiceTerms ?? '',
  upiId: s.upiId ?? '',
  weeklySummary: String(!!s.weeklySummary),
  requireTwoFactor: String(!!s.requireTwoFactor),
  msmeCategory: s.msmeCategory ?? '',
  udyamNumber: s.udyamNumber ?? '',
  msmeBankRate: s.msmeBankRateBp ? (s.msmeBankRateBp / 100).toFixed(2) : '',
  gstScheme: s.gstScheme ?? 'regular',
  compositionRate: String(s.compositionRateBp ?? 100),
  interestRate: s.interestRateBp ? String(s.interestRateBp / 100) : '',
  interestMethod: s.interestMethod ?? 'simple',
  interestGraceDays: String(s.interestGraceDays ?? 0),
  interestAutoRaise: String(!!s.interestAutoRaise),
  roundInvoiceTotals: String(!!s.roundInvoiceTotals),
  lutNumber: s.lutNumber ?? '',
  lutFrom: s.lutFrom ?? '',
  lutTo: s.lutTo ?? '',
  businessType: s.businessType ?? '',
  pan: s.pan ?? '',
  tan: s.tan ?? '',
  cin: s.cin ?? '',
  iec: s.iec ?? '',
  bankAccountName: s.bankDetails?.accountName ?? '',
  bankAccountNumber: s.bankDetails?.accountNumber ?? '',
  bankIfsc: s.bankDetails?.ifsc ?? '',
  bankName: s.bankDetails?.bankName ?? '',
  bankBranch: s.bankDetails?.branch ?? '',
  signatoryName: s.signatoryName ?? '',
  signatoryDesignation: s.signatoryDesignation ?? '',
});

/** Only what the person changed, shaped for PATCH /organization. Empty when nothing changed. */
export function changes(initial: SettingsValues, v: SettingsValues): OrganizationSettingsInput {
  const out: Record<string, unknown> = {};
  const address: Record<string, string> = {};
  for (const k of Object.keys(v) as SettingsField[]) {
    if (v[k] === initial[k]) continue;
    if (k in ADDRESS) address[k] = v[k];
    else if (k === 'fiscalYearStartMonth') out[k] = Number(v[k]);
    else if (k === 'country') out[k] = v[k] || null;
    else if (k === 'weeklySummary' || k === 'requireTwoFactor' || k === 'interestAutoRaise' || k === 'roundInvoiceTotals') out[k] = v[k] === 'true';
    else if (k === 'msmeCategory') out[k] = v[k] || null;
    else if (k === 'compositionRate') out.compositionRateBp = Number(v[k]);
    // A percentage typed as 5.5 or 5.50%: stored in basis points
    else if (k === 'msmeBankRate') out.msmeBankRateBp = v[k].trim() ? Math.round(Number(v[k].replace('%', '').trim()) * 100) : null;
    else if (k === 'interestRate') out.interestRateBp = v[k].trim() ? Math.round(Number(v[k].replace('%', '').trim()) * 100) : null;
    else if (k === 'interestGraceDays') out.interestGraceDays = Number(v[k] || 0);
    else if (k === 'lutFrom' || k === 'lutTo' || k === 'businessType') out[k] = v[k] || null;
    // The bank account goes as one: all of it, or null when cleared
    else if (BANK.includes(k)) out.bankDetails = bankValue({ accountName: v.bankAccountName, accountNumber: v.bankAccountNumber, ifsc: v.bankIfsc, bankName: v.bankName, branch: v.bankBranch });
    else out[k] = v[k];
  }
  if (Object.keys(address).length) out.address = address;
  return out as OrganizationSettingsInput;
}

/** The form field a validation issue belongs to (address.city → city). */
export const fieldOf = (path: PropertyKey[]): SettingsField | null => {
  const key = String(path[path.length - 1] ?? '');
  if (path[0] === 'bankDetails') return ({ accountName: 'bankAccountName', accountNumber: 'bankAccountNumber', ifsc: 'bankIfsc', bankName: 'bankName', branch: 'bankBranch' } as const)[key as 'ifsc'] ?? null;
  return key in ADDRESS || ['name', 'legalName', 'taxId', 'email', 'phone', 'country', 'baseCurrency', 'locale', 'timeZone', 'fiscalYearStartMonth', 'invoiceTerms', 'upiId', 'weeklySummary', 'requireTwoFactor', 'msmeCategory', 'udyamNumber', 'gstScheme', 'interestMethod', 'interestGraceDays', 'lutNumber', 'lutFrom', 'lutTo', 'businessType', 'pan', 'tan', 'cin', 'iec', 'signatoryName', 'signatoryDesignation'].includes(key) ? (key as SettingsField) : key === 'msmeBankRateBp' ? 'msmeBankRate' : key === 'interestRateBp' ? 'interestRate' : null;
};

/** Every time zone the browser knows, labelled with its current UTC offset: "Asia/Kolkata · GMT+5:30". */
export function timeZoneOptions(locale: string, current: string) {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = zones.includes(current) ? zones : [current, ...zones];
  return all.map((z) => {
    let offset = '';
    try {
      offset = new Intl.DateTimeFormat(locale, { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      /* label without the offset */
    }
    return { value: z, label: offset ? `${z.replace(/_/g, ' ')} · ${offset}` : z.replace(/_/g, ' ') };
  });
}

/** "April – March" for a financial year starting in April. */
export const fiscalYearSpan = (startMonth: number, locale: string) => `${monthName(startMonth, locale)} – ${monthName(((startMonth + 10) % 12) + 1, locale)}`;

/** The current time in a zone, e.g. "6:42 pm", to confirm the choice. */
export const timeIn = (zone: string, locale: string) => {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date());
  } catch {
    return '';
  }
};

export type LogoProblem = 'type' | 'size' | 'mismatch';

/** Reads a chosen logo file and applies the API's rules first, so mistakes show instantly. */
export async function readLogo(file: File): Promise<{ ok: true; type: LogoType; data: string } | { ok: false; problem: LogoProblem }> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return { ok: false, problem: 'type' };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, problem: 'size' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffLogoType(bytes) !== file.type) return { ok: false, problem: 'mismatch' };
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, type: file.type as LogoType, data: btoa(binary) };
}
