import { vi } from 'vitest';
import { BUILT_IN_ROLES } from '@ledgernest/shared';
import type { MeResponse } from '../auth/client';

export const BASE = 'http://api.test/api/v1';

export const ME: MeResponse = {
  user: { id: 'u1', email: 'asha@acme.in', name: 'Asha Rao', locale: 'en', isSuperAdmin: false },
  platformPermissions: [],
  organizations: [
    {
      id: 'o1',
      name: 'Acme Traders',
      slug: 'acme',
      status: 'ACTIVE',
      baseCurrency: 'INR',
      locale: 'en-IN',
      role: { type: 'built_in', key: 'accountant' },
      permissions: [...BUILT_IN_ROLES.accountant.permissions],
    },
  ],
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * An in-memory stand-in for the LedgerNest auth API, close enough to the real one:
 * a cookie-held refresh token, 15-minute access tokens, and the same status codes.
 */
export function fakeApi({ password = 'Right-Password-1', me = ME, signedIn = false } = {}) {
  const state = {
    cookie: signedIn ? 'r0' : (null as string | null),
    validAccess: new Set<string>(),
    counter: 0,
    /** Next login answer can be forced (e.g. 423) */
    loginStatus: null as null | { status: number; body?: unknown },
    networkDown: false,
    /** Emails a reset link was asked for */
    resetRequests: [] as string[],
    deleted: false,
    password,
  };
  /** The only reset link that works */
  const RESET_TOKEN = 'reset-token-0123456789abcdefghijklmnop';

  const issue = () => {
    const n = ++state.counter;
    state.cookie = `r${n}`;
    state.validAccess.add(`a${n}`);
    return { accessToken: `a${n}`, expiresIn: 900 };
  };

  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (state.networkDown) throw new TypeError('Failed to fetch');
    const path = String(input).replace(BASE, '');
    const auth = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '');

    switch (`${init.method ?? 'GET'} ${path}`) {
      case 'POST /auth/login': {
        if (state.loginStatus) return json(state.loginStatus.status, state.loginStatus.body ?? { message: 'forced' });
        const body = JSON.parse(String(init.body)) as { email: string; password: string };
        if (body.email !== me.user.email || body.password !== state.password) return json(401, { message: 'Email or password is incorrect.' });
        return json(200, issue());
      }
      case 'POST /auth/refresh':
        return state.cookie ? json(200, issue()) : json(401, { message: 'Please sign in again.' });
      case 'POST /auth/logout':
        state.cookie = null;
        state.validAccess.clear();
        return json(204);
      case 'POST /auth/forgot-password':
        state.resetRequests.push((JSON.parse(String(init.body)) as { email: string }).email);
        return json(204);
      case 'POST /auth/reset-password': {
        const body = JSON.parse(String(init.body)) as { token: string; password: string };
        if (body.token !== RESET_TOKEN) return json(400, { message: 'expired', details: { reason: 'invalid_token' } });
        state.password = body.password;
        state.cookie = null;
        state.validAccess.clear();
        return json(204);
      }
      case 'POST /auth/change-password': {
        if (!auth || !state.validAccess.has(auth)) return json(401, { message: 'expired' });
        const body = JSON.parse(String(init.body)) as { currentPassword: string; newPassword: string };
        if (body.currentPassword !== state.password) return json(400, { message: 'wrong', details: { reason: 'wrong_password' } });
        state.password = body.newPassword;
        return json(204);
      }
      case 'POST /auth/delete-account': {
        if (!auth || !state.validAccess.has(auth)) return json(401, { message: 'expired' });
        const body = JSON.parse(String(init.body)) as { password: string };
        if (body.password !== state.password) return json(400, { message: 'wrong', details: { reason: 'wrong_password' } });
        state.cookie = null;
        state.validAccess.clear();
        state.deleted = true;
        return json(204);
      }
      case 'POST /auth/logout-all':
        if (!auth || !state.validAccess.has(auth)) return json(401, { message: 'expired' });
        state.cookie = null;
        state.validAccess.clear();
        return json(200, { sessions: 2 });
      case 'GET /auth/me':
        return auth && state.validAccess.has(auth) ? json(200, me) : json(401, { message: 'expired' });
      default:
        return json(404, { message: 'not found' });
    }
  });

  return {
    fetch,
    state,
    RESET_TOKEN,
    /** Simulates the 15 minutes passing: every access token stops working. */
    expireAccessTokens: () => state.validAccess.clear(),
    /** Simulates the session being revoked elsewhere (e.g. sign-out on another device). */
    revokeSession: () => {
      state.cookie = null;
      state.validAccess.clear();
    },
    calls: (path: string) => fetch.mock.calls.filter(([url]) => String(url).endsWith(path)).length,
  };
}
