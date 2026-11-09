import type { AuthClient } from '../auth/client';
import type { ItemsApi } from './types';

/** Items backed by the real API, always for one organisation. */
export function createLiveItemsApi(client: AuthClient, organizationId: string): ItemsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/items${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (q) => {
      const p = new URLSearchParams();
      if (q.search) p.set('search', q.search);
      if (q.kind) p.set('kind', q.kind);
      if (q.archived) p.set('archived', 'true');
      return r(`?${p}`);
    },
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    archive: (id, archive) => r(`/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
