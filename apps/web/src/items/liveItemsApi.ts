import type { AuthClient } from '../auth/client';
import type { ItemsApi } from './types';

/** Items backed by the real API, always for one organisation. */
export function createLiveItemsApi(client: AuthClient, organizationId: string): ItemsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/items${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    exportList: async (q) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
      const { blob, filename } = await client.download(`/items/export?${p}`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'items.csv' };
    },
    list: (q) => {
      const p = new URLSearchParams();
      if (q.search) p.set('search', q.search);
      if (q.kind) p.set('kind', q.kind);
      if (q.category) p.set('category', q.category);
      if (q.archived) p.set('archived', 'true');
      return r(`?${p}`);
    },
    facets: () => r('/facets'),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    archive: (id, archive) => r(`/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
