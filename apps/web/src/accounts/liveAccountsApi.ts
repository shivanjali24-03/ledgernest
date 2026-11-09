import type { AuthClient } from '../auth/client';
import type { AccountsApi } from './types';

/** The chart of accounts backed by the real API, always for one organisation. */
export function createLiveAccountsApi(client: AuthClient, organizationId: string): AccountsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/accounts${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (includeArchived) => r(includeArchived ? '?includeArchived=true' : ''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    archive: (id) => r(`/${id}/archive`, { method: 'POST' }),
    restore: (id) => r(`/${id}/restore`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
