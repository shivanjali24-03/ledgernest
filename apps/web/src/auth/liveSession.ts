import { BUILT_IN_ROLES, permissionsOf } from '@ledgernest/shared';
import type { Session } from '../layout/session';
import type { MeResponse } from './client';

/**
 * Turns the API's /auth/me answer into the app's session.
 * Until the organisation switcher lands, the first organisation is the active one.
 * The menu only hides what you can't use; the API still checks every request.
 */
export function liveSession(me: MeResponse, signOut: () => Promise<void>): Session {
  const org = me.organizations[0];
  const base = { mode: 'live' as const, name: me.user.name, email: me.user.email, organization: org?.name ?? null, organizationId: org?.id ?? null, signOut };

  if (me.user.isSuperAdmin) {
    return { ...base, role: 'super_admin', permissions: permissionsOf([BUILT_IN_ROLES.super_admin]) };
  }
  if (!org) return { ...base, role: null, permissions: new Set() };

  return org.role.type === 'built_in'
    ? { ...base, role: org.role.key, permissions: new Set(org.permissions) }
    : { ...base, role: null, customRoleName: org.role.name, permissions: new Set(org.permissions) };
}

/** Only follow `next` to a path inside this app, never to another site (e.g. "//evil.com"). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/sign-in')) return '/';
  return next;
}
