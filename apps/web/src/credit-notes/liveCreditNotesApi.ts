import type { AuthClient } from '../auth/client';
import type { CreditNotesApi } from './types';

/** Credit notes backed by the real API, always for one organisation. */
export function createLiveCreditNotesApi(client: AuthClient, organizationId: string): CreditNotesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/credit-notes${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.contactId) p.set('contactId', q.contactId);
      if (q.invoiceId) p.set('invoiceId', q.invoiceId);
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    email: (id, input) => r(`/${id}/email`, { method: 'POST', json: input }),
    pdf: async (id) => {
      const { blob, filename } = await client.download(`/credit-notes/${id}/pdf`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'credit-note.pdf' };
    },
    creditable: (invoiceId) => r(`/creditable/${invoiceId}`),
    create: (input) => r('', { method: 'POST', json: input }),
    apply: (id, input) => r(`/${id}/apply`, { method: 'POST', json: input }),
    refund: (id, input) => r(`/${id}/refund`, { method: 'POST', json: input }),
    void: (id, reason) => r(`/${id}/void`, { method: 'POST', json: reason ? { reason } : {} }),
  };
}
