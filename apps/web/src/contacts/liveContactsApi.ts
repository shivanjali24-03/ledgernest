import type { AuthClient } from '../auth/client';
import type { ContactsApi } from './types';

/** Contacts backed by the real API, always for one organisation. */
export function createLiveContactsApi(client: AuthClient, organizationId: string): ContactsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/contacts${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.search) p.set('search', q.search);
      if (q.type) p.set('type', q.type);
      if (q.archived) p.set('archived', 'true');
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    archive: (id, archive) => r(`/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
