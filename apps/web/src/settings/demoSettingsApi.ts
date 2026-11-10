import { organizationSettingsSchema, sniffLogoType } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { OrganizationSettings, SettingsApi } from './types';

/**
 * Settings in demo mode, for the sample company. Validated with the same shared rules as the API.
 * The sample company already has posted entries, so its base currency is locked, as it would be for real.
 */

const KEY = 'ledgernest.demo.settings';
type Stored = { settings: OrganizationSettings; logo: { type: string; data: string } | null };

function seed(): Stored {
  return {
    settings: {
      id: 'o-1',
      name: 'Nest Demo Pvt. Ltd.',
      slug: 'nest-demo-pvt-ltd',
      status: 'ACTIVE',
      baseCurrency: 'INR',
      locale: 'en-IN',
      timeZone: 'Asia/Kolkata',
      country: 'IN',
      fiscalYearStartMonth: 4,
      legalName: 'Nest Demo Private Limited',
      taxId: '27AAPFN1234C1Z5',
      email: 'accounts@nestdemo.in',
      phone: '+91 20 4000 1234',
      address: { line1: '4th Floor, Riverside Business Bay', line2: 'Baner Road', city: 'Pune', region: 'Maharashtra', postalCode: '411045' },
      logo: null,
      locks: { baseCurrency: true, fiscalYearStartMonth: false },
    },
    logo: null,
  };
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    /* fall through to the sample data */
  }
  return seed();
}
function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: changes last until reload */
  }
}

/** The demo company's settings as they stand (for invoices' interest terms) */
export const demoSettings = () => load().settings;

/** Test helper */
export const resetDemoSettings = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const forbidden = () => new ApiError('forbidden', 403, undefined, undefined, { missing: ['org.settings.manage'] });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => fn())().then(resolve, reject), 200));

export function createDemoSettingsApi(canManage: () => boolean): SettingsApi {
  return {
    get: () => wait(() => load().settings),
    update: (input) =>
      wait(() => {
        if (!canManage()) throw forbidden();
        const parsed = organizationSettingsSchema.safeParse(input);
        if (!parsed.success) throw new ApiError('validation', 400, undefined, undefined, { fields: parsed.error.issues });
        const s = load();
        const { address, ...rest } = parsed.data;
        if (rest.baseCurrency && rest.baseCurrency !== s.settings.baseCurrency && s.settings.locks.baseCurrency) {
          throw new ApiError('conflict', 409, undefined, undefined, { reason: 'locked', field: 'baseCurrency' });
        }
        s.settings = { ...s.settings, ...rest, address: { ...s.settings.address, ...address } } as OrganizationSettings;
        save(s);
        return s.settings;
      }),
    setLogo: (upload) =>
      wait(() => {
        if (!canManage()) throw forbidden();
        const bytes = Uint8Array.from(atob(upload.data), (c) => c.charCodeAt(0));
        if (sniffLogoType(bytes) !== upload.type) throw new ApiError('validation', 400, undefined, undefined, { reason: 'type_mismatch' });
        const s = load();
        s.logo = upload;
        s.settings.logo = { contentType: upload.type, updatedAt: new Date().toISOString() };
        save(s);
        return s.settings;
      }),
    // The demo starts over: every sample record is cleared and comes back fresh
    remove: async (confirmName) => {
      if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['org.delete'] });
      if (confirmName.trim() !== load().settings.name.trim()) throw new ApiError('validation', 400, undefined, undefined, { reason: 'name_mismatch' });
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('ledgernest.demo.')) localStorage.removeItem(k);
      } catch {
        /* storage unavailable */
      }
    },
    removeLogo: () =>
      wait(() => {
        if (!canManage()) throw forbidden();
        const s = load();
        s.logo = null;
        s.settings.logo = null;
        save(s);
      }),
    logo: () =>
      wait(() => {
        const l = load().logo;
        return l ? new Blob([Uint8Array.from(atob(l.data), (c) => c.charCodeAt(0))], { type: l.type }) : null;
      }),
  };
}
