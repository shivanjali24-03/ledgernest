import type { AuthClient } from '../auth/client';
import type { PurchaseOrdersApi } from './types';

/** Purchase orders backed by the real API, always for one organisation. */
export function createLivePurchaseOrdersApi(client: AuthClient, organizationId: string): PurchaseOrdersApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/purchase-orders${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.status) p.set('status', q.status);
      if (q.search) p.set('search', q.search);
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    move: (id, status) => r(`/${id}/status`, { method: 'POST', json: { status } }),
    receive: (id, input) => r(`/${id}/receipts`, { method: 'POST', json: input }),
    bill: (id) => r(`/${id}/bill`, { method: 'POST' }),
  };
}
