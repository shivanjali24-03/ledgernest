import type { BuiltInRoleId, Permission } from '@ledgernest/shared';

/** What GET /auth/me returns. */
export interface MeResponse {
  user: { id: string; email: string; name: string; locale: string; isSuperAdmin: boolean };
  platformPermissions: Permission[];
  organizations: {
    id: string;
    name: string;
    slug: string;
    status: string;
    baseCurrency: string;
    locale: string;
    role: { type: 'built_in'; key: BuiltInRoleId } | { type: 'custom'; key: string | null; name?: string };
    permissions: Permission[];
  }[];
}

/** Every failure is mapped to a kind, so the UI shows a translated message instead of the server's English. */
export type ApiErrorKind =
  | 'invalid_credentials'
  | 'locked'
  | 'suspended'
  | 'rate_limited'
  | 'validation'
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'network'
  | 'server';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly retryAfterMinutes?: number;
  /** Extra information from the API, e.g. { field: 'slug' } or { missing: [...] } */
  readonly details?: Record<string, unknown>;

  constructor(kind: ApiErrorKind, status: number, message?: string, retryAfterMinutes?: number, details?: Record<string, unknown>) {
    super(message ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMinutes = retryAfterMinutes;
    this.details = details;
  }
}

async function toApiError(res: Response, during: 'login' | 'request'): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; details?: Record<string, unknown> & { retryAfterMinutes?: number } };
  const kind: ApiErrorKind =
    res.status === 401
      ? during === 'login'
        ? 'invalid_credentials'
        : 'session_expired'
      : res.status === 423
        ? 'locked'
        : res.status === 403
          ? during === 'login'
            ? 'suspended'
            : 'forbidden'
          : res.status === 429
            ? 'rate_limited'
            : res.status === 400
              ? 'validation'
              : res.status === 404
                ? 'not_found'
                : res.status === 409
                  ? 'conflict'
                  : res.status === 410
                    ? 'gone'
                    : 'server';
  const details = Array.isArray(body.details) ? { fields: body.details } : body.details;
  return new ApiError(kind, res.status, body.message, body.details?.retryAfterMinutes, details);
}

/**
 * Runs the refresh inside a browser-wide lock. Without it, two tabs refreshing at the same moment
 * would both send the same refresh token, and the server would (correctly) treat the second as theft.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('ledgernest-refresh', fn) : fn();
}

export type AuthClient = ReturnType<typeof createAuthClient>;

/**
 * Talks to the LedgerNest API.
 * - The access token lives only in memory (never localStorage), so injected scripts can't steal it from storage.
 * - The refresh token is an httpOnly cookie the browser sends to /auth only.
 * - A 401 triggers one silent refresh and retry; if that fails, listeners hear "session lost".
 */
export function createAuthClient(baseUrl: string, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {
  let accessToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  const lostListeners = new Set<() => void>();

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    try {
      return await fetchImpl(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    } catch {
      throw new ApiError('network', 0);
    }
  }

  /** Signs in; with two-factor on, gives back a ticket for the code instead */
  async function login(email: string, password: string): Promise<{ ticket: string } | undefined> {
    const res = await send('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!res.ok) throw await toApiError(res, 'login');
    const body = (await res.json()) as { accessToken?: string; twoFactorRequired?: boolean; ticket?: string };
    if (body.twoFactorRequired && body.ticket) return { ticket: body.ticket };
    accessToken = body.accessToken!;
    return undefined;
  }

  /** The second step: a code from the authenticator app, or a recovery code */
  async function loginTwoFactor(ticket: string, code: string): Promise<void> {
    const res = await send('/auth/login/2fa', { method: 'POST', body: JSON.stringify({ ticket, code }) });
    if (!res.ok) throw await toApiError(res, 'login');
    accessToken = ((await res.json()) as { accessToken: string }).accessToken;
  }

  /** Accepting an invitation as a new person also signs them in. */
  async function acceptInvitation(token: string, name: string, password: string): Promise<void> {
    const res = await send('/invitations/accept', { method: 'POST', body: JSON.stringify({ token, name, password }) });
    if (!res.ok) throw await toApiError(res, 'request');
    accessToken = ((await res.json()) as { accessToken: string }).accessToken;
  }

  /** Gets a new access token from the refresh cookie. Resolves false when there is no valid session. */
  function refresh(): Promise<boolean> {
    refreshing ??= withRefreshLock(async () => {
      const res = await send('/auth/refresh', { method: 'POST' });
      if (res.ok) {
        accessToken = ((await res.json()) as { accessToken: string }).accessToken;
        return true;
      }
      accessToken = null;
      if (res.status >= 500 || res.status === 429) throw await toApiError(res, 'request');
      return false;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** Sends an authenticated call, refreshing the session once on 401. Throws ApiError unless the response is OK. */
  async function authorized(path: string, { json, ...init }: RequestInit & { json?: unknown } = {}): Promise<Response> {
    if (json !== undefined) init.body = JSON.stringify(json);
    let res = await send(path, init);
    if (res.status === 401 && (await refresh())) res = await send(path, init);
    if (res.status === 401) {
      accessToken = null;
      lostListeners.forEach((fn) => fn());
      throw new ApiError('session_expired', 401);
    }
    if (!res.ok) throw await toApiError(res, 'request');
    return res;
  }

  /** An authenticated API call. Objects passed as `json` are sent as the JSON body. */
  async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const res = await authorized(path, init);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** An authenticated file download (e.g. a CSV export), with the server's suggested file name. */
  async function download(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string | null; headers: Headers }> {
    const res = await authorized(path, init);
    const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? null;
    return { blob: await res.blob(), filename, headers: res.headers };
  }

  /** Asks for a reset link; the answer is the same whether or not the address has an account */
  async function forgotPassword(email: string): Promise<void> {
    const res = await send('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    if (!res.ok) throw await toApiError(res, 'request');
  }

  /** Sets a new password from a reset link (every device is signed out) */
  async function resetPassword(token: string, password: string): Promise<void> {
    const res = await send('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
    if (!res.ok) throw await toApiError(res, 'request');
    accessToken = null;
  }

  async function logout(): Promise<void> {
    try {
      await send('/auth/logout', { method: 'POST' });
    } finally {
      accessToken = null;
    }
  }

  return {
    login,
    loginTwoFactor,
    twoFactor: {
      status: () => request<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number }>('/auth/2fa'),
      setup: (password: string) => request<{ secret: string; uri: string }>('/auth/2fa/setup', { method: 'POST', json: { password } }),
      enable: (code: string) => request<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', json: { code } }),
      disable: (password: string, code: string) => request<void>('/auth/2fa/disable', { method: 'POST', json: { password, code } }),
      recoveryCodes: (code: string) => request<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { method: 'POST', json: { code } }),
    },
    acceptInvitation,
    refresh,
    logout,
    request,
    download,
    me: () => request<MeResponse>('/auth/me'),
    forgotPassword,
    resetPassword,
    /** Other devices are signed out; this one stays */
    changePassword: (currentPassword: string, newPassword: string) => request<void>('/auth/change-password', { method: 'POST', json: { currentPassword, newPassword } }),
    /** Erases the account; the session ends with it */
    deleteAccount: async (password: string) => {
      await request<void>('/auth/delete-account', { method: 'POST', json: { password } });
      accessToken = null;
    },
    logoutAll: async () => {
      try {
        await request<{ sessions: number }>('/auth/logout-all', { method: 'POST' });
      } finally {
        accessToken = null;
      }
    },
    /** Called when the session can't be renewed (expired, revoked, or the account was suspended). */
    onSessionLost(fn: () => void) {
      lostListeners.add(fn);
      return () => void lostListeners.delete(fn);
    },
  };
}

/** Set VITE_API_URL (e.g. http://localhost:3000/api/v1) to use the real API. Without it the app runs as a demo. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || undefined;
