import type { AuthClient } from '../auth/client';
import type { InvoicesApi } from './types';

/** Invoices backed by the real API, always for one organisation. */
export function createLiveInvoicesApi(client: AuthClient, organizationId: string): InvoicesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/invoices${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
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
    issue: (id) => r(`/${id}/issue`, { method: 'POST' }),
    void: (id, input) => r(`/${id}/void`, { method: 'POST', json: input }),
    remind: (id, input) => r(`/${id}/remind`, { method: 'POST', json: input }),
    email: (id, input) => r(`/${id}/email`, { method: 'POST', json: input }),
    remindOverdue: (contactId) => r('/remind-overdue', { method: 'POST', json: { contactId } }),
    reminderPolicy: () => client.request('/reminder-policy', { headers: { 'X-Organization-Id': organizationId } }),
    setReminderPolicy: (policy) => client.request('/reminder-policy', { method: 'PUT', json: policy, headers: { 'X-Organization-Id': organizationId } }),
  };
}
