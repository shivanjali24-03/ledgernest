import type { AuthClient } from '../auth/client';
import type { PaymentsApi } from './types';

/** Receipts and payments backed by the real API, always for one organisation. */
export function createLivePaymentsApi(client: AuthClient, organizationId: string): PaymentsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/payments${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    pdf: async (id) => {
      const { blob, filename } = await client.download(`/payments/${id}/pdf`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'receipt.pdf' };
    },
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.kind) p.set('kind', q.kind);
      if (q.contactId) p.set('contactId', q.contactId);
      return r(`?${p}`);
    },
    openInvoices: (contactId) => r(`/open-invoices/${contactId}`),
    openBills: (contactId) => r(`/open-bills/${contactId}`),
    receive: (input) => r('/receipts', { method: 'POST', json: input }),
    pay: (input) => r('/payments', { method: 'POST', json: input }),
    email: (id, input) => r(`/${id}/email`, { method: 'POST', json: input }),
    void: (id, reason) => r(`/${id}/void`, { method: 'POST', json: reason ? { reason } : {} }),
  };
}
