import { BUILT_IN_ROLES } from '@ledgernest/shared';
import { ME } from '../test/fakeApi';
import type { MeResponse } from './client';
import { nameFromEmail } from './context';
import { liveSession, safeNext } from './liveSession';

const signOut = async () => {};
const org = ME.organizations[0]!;

describe('liveSession', () => {
  it('uses the role and permissions from the first organisation', () => {
    const s = liveSession(ME, signOut);
    expect(s).toMatchObject({ mode: 'live', name: 'Asha Rao', organization: 'Acme Traders', role: 'accountant' });
    expect([...s.permissions]).toEqual(org.permissions);
    expect(s.setRole).toBeUndefined(); // no role preview with real data
  });

  it('shows a custom role by its name', () => {
    const me: MeResponse = { ...ME, organizations: [{ ...org, role: { type: 'custom', key: 'r9', name: 'Branch cashier' } }] };
    expect(liveSession(me, signOut)).toMatchObject({ role: null, customRoleName: 'Branch cashier' });
  });

  it('gives a Super Admin everything, even without an organisation', () => {
    const me: MeResponse = { ...ME, user: { ...ME.user, isSuperAdmin: true }, organizations: [] };
    const s = liveSession(me, signOut);
    expect(s).toMatchObject({ role: 'super_admin', organization: null });
    expect(s.permissions).toEqual(new Set(BUILT_IN_ROLES.super_admin.permissions));
  });

  it('a user with no organisation can do nothing yet', () => {
    expect(liveSession({ ...ME, organizations: [] }, signOut).permissions.size).toBe(0);
  });
});

describe('safeNext', () => {
  it.each([
    ['/reports', '/reports'],
    ['/reports?year=2026', '/reports?year=2026'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/sign-in', '/'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('nameFromEmail', () => {
  it.each([
    ['asha.rao@acme.in', 'Asha Rao'],
    ['j_doe@x.io', 'J Doe'],
    ['@x.io', 'Demo User'],
  ])('%s → %s', (email, name) => expect(nameFromEmail(email)).toBe(name));
});
