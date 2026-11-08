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
export type ApiErrorKind = 'invalid_credentials' | 'locked' | 'suspended' | 'rate_limited' | 'validation' | 'session_expired' | 'network' | 'server';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly retryAfterMinutes?: number;

  constructor(kind: ApiErrorKind, status: number, message?: string, retryAfterMinutes?: number) {
    super(message ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

async function toApiError(res: Response, during: 'login' | 'request'): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; details?: { retryAfterMinutes?: number } };
  const kind: ApiErrorKind =
    res.status === 401
      ? during === 'login'
        ? 'invalid_credentials'
        : 'session_expired'
      : res.status === 423
        ? 'locked'
        : res.status === 403 && during === 'login'
          ? 'suspended'
          : res.status === 429
            ? 'rate_limited'
            : res.status === 400
              ? 'validation'
              : 'server';
  return new ApiError(kind, res.status, body.message, body.details?.retryAfterMinutes);
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

  async function login(email: string, password: string): Promise<void> {
    const res = await send('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!res.ok) throw await toApiError(res, 'login');
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

  /** An authenticated API call. */
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res = await send(path, init);
    if (res.status === 401 && (await refresh())) res = await send(path, init);
    if (res.status === 401) {
      accessToken = null;
      lostListeners.forEach((fn) => fn());
      throw new ApiError('session_expired', 401);
    }
    if (!res.ok) throw await toApiError(res, 'request');
    return (res.status === 204 ? undefined : await res.json()) as T;
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
    refresh,
    logout,
    request,
    me: () => request<MeResponse>('/auth/me'),
    /** Called when the session can't be renewed (expired, revoked, or the account was suspended). */
    onSessionLost(fn: () => void) {
      lostListeners.add(fn);
      return () => void lostListeners.delete(fn);
    },
  };
}

/** Set VITE_API_URL (e.g. http://localhost:3000/api/v1) to use the real API. Without it the app runs as a demo. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || undefined;
