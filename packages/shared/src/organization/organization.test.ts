import { describe, expect, it } from 'vitest';
import { isCurrency, isTimeZone, LOGO_MAX_BYTES, logoUploadSchema, organizationSettingsSchema, sniffLogoType } from './index.js';

describe('organisation settings', () => {
  const parse = (v: unknown) => organizationSettingsSchema.safeParse(v);

  it('accepts a partial update and tidies values', () => {
    const r = parse({ taxId: ' 27aapfu0939f1zv ', email: '', phone: '+91 98200 12345', address: { city: ' Pune ', line2: '' } });
    expect(r.success && r.data).toEqual({ taxId: '27AAPFU0939F1ZV', email: null, phone: '+91 98200 12345', address: { city: 'Pune', line2: null } });
  });

  it('refuses an empty update, an unknown currency or time zone, and a bad tax ID', () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ baseCurrency: 'XYZ1' }).success).toBe(false);
    expect(parse({ baseCurrency: 'usd' }).success && parse({ baseCurrency: 'usd' }).data).toEqual({ baseCurrency: 'USD' });
    expect(parse({ timeZone: 'Mars/Olympus' }).success).toBe(false);
    expect(parse({ taxId: '<script>' }).success).toBe(false);
    expect(parse({ fiscalYearStartMonth: 13 }).success).toBe(false);
  });

  it('knows real currencies and time zones', () => {
    expect(isCurrency('INR')).toBe(true);
    expect(isCurrency('AB')).toBe(false);
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Nowhere/Land')).toBe(false);
  });
});

describe('logo upload', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');

  it('recognises images by their bytes, not their claimed type', () => {
    expect(sniffLogoType(png)).toBe('image/png');
    expect(sniffLogoType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffLogoType(webp)).toBe('image/webp');
    expect(sniffLogoType(svg)).toBeNull();
  });

  it('accepts only PNG, JPEG or WebP under 256 KB', () => {
    expect(logoUploadSchema.safeParse({ type: 'image/svg+xml', data: 'AAAA' }).success).toBe(false);
    expect(logoUploadSchema.safeParse({ type: 'image/png', data: 'not base64!' }).success).toBe(false);
    expect(logoUploadSchema.safeParse({ type: 'image/png', data: 'A'.repeat(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4) }).success).toBe(false);
    expect(logoUploadSchema.safeParse({ type: 'image/png', data: 'iVBORw0KGgo=' }).success).toBe(true);
  });
});
