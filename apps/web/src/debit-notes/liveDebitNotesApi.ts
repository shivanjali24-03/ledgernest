import type { AuthClient } from '../auth/client';
import type { DebitNotesApi } from './types';

/** Debit notes backed by the real API, always for one organisation. */
export function createLiveDebitNotesApi(client: AuthClient, organizationId: string): DebitNotesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/debit-notes${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.contactId) p.set('contactId', q.contactId);
      if (q.billId) p.set('billId', q.billId);
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    creditable: (billId) => r(`/creditable/${billId}`),
    create: (input) => r('', { method: 'POST', json: input }),
    apply: (id, input) => r(`/${id}/apply`, { method: 'POST', json: input }),
    refund: (id, input) => r(`/${id}/refund`, { method: 'POST', json: input }),
    void: (id, reason) => r(`/${id}/void`, { method: 'POST', json: reason ? { reason } : {} }),
  };
}
