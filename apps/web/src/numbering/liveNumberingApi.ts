import type { AuthClient } from '../auth/client';
import type { NumberingApi } from './types';

/** Number series backed by the real API, always for one organisation. */
export function createLiveNumberingApi(client: AuthClient, organizationId: string): NumberingApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/number-series${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, patch) => r(`/${id}`, { method: 'PATCH', json: patch }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
