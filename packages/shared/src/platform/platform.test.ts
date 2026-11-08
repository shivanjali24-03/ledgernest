import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, organizationCreateSchema, organizationUpdateSchema, slugify, SLUG_PATTERN } from './index.js';

describe('slugify', () => {
  it.each([
    ["Asha's Café & Co.", 'ashas-cafe-co'],
    ['  Acme   Traders  ', 'acme-traders'],
    ['Ünïcödé GmbH', 'unicode-gmbh'],
    ['---', ''],
  ])('%s → %s', (name, slug) => expect(slugify(name)).toBe(slug));

  it('never produces an invalid slug for real names', () => {
    for (const n of ['A', 'Shree Ganesh Traders Pvt. Ltd.', 'x'.repeat(200), 'Mumbai — Branch 2']) {
      const s = slugify(n);
      if (s) expect(s).toMatch(SLUG_PATTERN);
    }
  });
});

describe('organizationCreateSchema', () => {
  it('fills sensible Indian defaults and normalises codes', () => {
    const v = organizationCreateSchema.parse({ name: 'Acme', baseCurrency: 'usd', owner: { email: 'Owner@Acme.IN' } });
    expect(v).toMatchObject({ baseCurrency: 'USD', locale: 'en-IN', fiscalYearStartMonth: 4, country: null, owner: { email: 'owner@acme.in' } });
  });

  it('rejects bad codes and months', () => {
    expect(organizationCreateSchema.safeParse({ name: 'Acme', baseCurrency: 'RUPEE', owner: { email: 'a@b.co' } }).success).toBe(false);
    expect(organizationCreateSchema.safeParse({ name: 'Acme', fiscalYearStartMonth: 13, owner: { email: 'a@b.co' } }).success).toBe(false);
    expect(organizationCreateSchema.safeParse({ name: 'Acme', slug: 'Bad Slug', owner: { email: 'a@b.co' } }).success).toBe(false);
  });

  it('an update must change something', () => {
    expect(organizationUpdateSchema.safeParse({}).success).toBe(false);
    expect(organizationUpdateSchema.safeParse({ name: 'New name' }).success).toBe(true);
  });
});

describe('acceptInvitationSchema', () => {
  const token = 't'.repeat(40);
  it('new people need a name and a strong password', () => {
    expect(acceptInvitationSchema.safeParse({ token, name: 'Asha', password: 'weak' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token, name: 'A', password: 'Strong-Password-1' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token, name: 'Asha', password: 'Strong-Password-1' }).success).toBe(true);
  });
  it('rejects a missing or tiny token', () => {
    expect(acceptInvitationSchema.safeParse({ token: 'x', name: 'Asha', password: 'Strong-Password-1' }).success).toBe(false);
  });
});
