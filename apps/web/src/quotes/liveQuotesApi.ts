import type { AuthClient } from '../auth/client';
import type { QuotesApi } from './types';

/** Quotes backed by the real API, always for one organisation. */
export function createLiveQuotesApi(client: AuthClient, organizationId: string): QuotesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/quotes${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    pdf: async (id) => {
      const { blob, filename } = await client.download(`/quotes/${id}/pdf`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'quote.pdf' };
    },
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.state) p.set('state', q.state);
      if (q.contactId) p.set('contactId', q.contactId);
      if (q.search) p.set('search', q.search);
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    move: (id, status) => r(`/${id}/status`, { method: 'POST', json: { status } }),
    convert: (id, input) => r(`/${id}/convert`, { method: 'POST', json: input }),
    email: (id, input) => r(`/${id}/email`, { method: 'POST', json: input }),
    share: (id) => r(`/${id}/share`, { method: 'POST' }),
    unshare: (id) => r(`/${id}/share`, { method: 'DELETE' }),
  };
}
