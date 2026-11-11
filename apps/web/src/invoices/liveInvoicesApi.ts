import type { AuthClient } from '../auth/client';
import type { InvoicesApi } from './types';

/** Invoices backed by the real API, always for one organisation. */
export function createLiveInvoicesApi(client: AuthClient, organizationId: string): InvoicesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/invoices${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    pdf: async (id) => {
      const { blob, filename } = await client.download(`/invoices/${id}/pdf`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'invoice.pdf' };
    },
    exportList: async (q) => {
      const p = new URLSearchParams();
      if (q.state) p.set('state', q.state);
      if (q.contactId) p.set('contactId', q.contactId);
      if (q.search) p.set('search', q.search);
      const { blob, filename } = await client.download(`/invoices/export?${p}`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'invoices.csv' };
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
    issue: (id) => r(`/${id}/issue`, { method: 'POST' }),
    void: (id, input) => r(`/${id}/void`, { method: 'POST', json: input }),
    remind: (id, input) => r(`/${id}/remind`, { method: 'POST', json: input }),
    email: (id, input) => r(`/${id}/email`, { method: 'POST', json: input }),
    share: (id) => r(`/${id}/share`, { method: 'POST' }),
    einvoice: async (id) => {
      const { blob, filename } = await client.download(`/invoices/${id}/e-invoice`, { headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'e-invoice.json' };
    },
    einvoices: (from, to) => r(`/e-invoice?from=${from}&to=${to}`),
    ewayBill: async (id, transport) => {
      const { blob, filename } = await client.download(`/invoices/${id}/e-way-bill`, { method: 'POST', body: JSON.stringify(transport), headers: { 'X-Organization-Id': organizationId } });
      return { blob, filename: filename ?? 'e-way-bill.json' };
    },
    setIrn: (id, input) => r(`/${id}/irn`, { method: 'PUT', json: input }),
    clearIrn: (id) => r(`/${id}/irn`, { method: 'DELETE' }),
    unshare: async (id) => {
      await r(`/${id}/share`, { method: 'DELETE' });
    },
    remindOverdue: (contactId) => r('/remind-overdue', { method: 'POST', json: { contactId } }),
    reminderPolicy: () => client.request('/reminder-policy', { headers: { 'X-Organization-Id': organizationId } }),
    setReminderPolicy: (policy) => client.request('/reminder-policy', { method: 'PUT', json: policy, headers: { 'X-Organization-Id': organizationId } }),
  };
}
