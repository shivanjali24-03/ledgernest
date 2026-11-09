import { changes, fieldOf, fiscalYearSpan, readLogo, timeZoneOptions, toValues } from './form';
import type { OrganizationSettings } from './types';

const settings: OrganizationSettings = {
  id: 'o-1', name: 'Acme', slug: 'acme', status: 'ACTIVE', baseCurrency: 'INR', locale: 'en-IN', timeZone: 'Asia/Kolkata', country: 'IN', fiscalYearStartMonth: 4,
  legalName: null, taxId: null, email: null, phone: null,
  address: { line1: null, line2: null, city: 'Pune', region: null, postalCode: null },
  logo: null, locks: { baseCurrency: false, fiscalYearStartMonth: false },
};

describe('settings form', () => {
  it('sends only what changed, with the address nested and the month as a number', () => {
    const initial = toValues(settings);
    expect(changes(initial, initial)).toEqual({});
    expect(changes(initial, { ...initial, legalName: 'Acme Pvt Ltd', city: 'Mumbai', fiscalYearStartMonth: '1', country: '' })).toEqual({
      legalName: 'Acme Pvt Ltd',
      country: null,
      fiscalYearStartMonth: 1,
      address: { city: 'Mumbai' },
    });
  });

  it('maps API issue paths to form fields', () => {
    expect(fieldOf(['address', 'postalCode'])).toBe('postalCode');
    expect(fieldOf(['timeZone'])).toBe('timeZone');
    expect(fieldOf(['slug'])).toBeNull();
  });

  it('labels time zones with their offset and describes the financial year', () => {
    const tz = timeZoneOptions('en', 'Asia/Kolkata');
    expect(tz.find((o) => o.value === 'Asia/Kolkata')?.label).toBe('Asia/Kolkata · GMT+5:30');
    expect(fiscalYearSpan(4, 'en')).toBe('April – March');
    expect(fiscalYearSpan(1, 'en')).toBe('January – December');
  });
});

describe('logo files', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it('accepts a real PNG and encodes it', async () => {
    const r = await readLogo(new File([png], 'logo.png', { type: 'image/png' }));
    expect(r).toEqual({ ok: true, type: 'image/png', data: btoa(String.fromCharCode(...png)) });
  });

  it('refuses SVGs, oversized files and files that are not what they claim', async () => {
    expect(await readLogo(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))).toEqual({ ok: false, problem: 'type' });
    expect(await readLogo(new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' }))).toEqual({ ok: false, problem: 'size' });
    expect(await readLogo(new File(['GIF89a'], 'fake.png', { type: 'image/png' }))).toEqual({ ok: false, problem: 'mismatch' });
  });
});
