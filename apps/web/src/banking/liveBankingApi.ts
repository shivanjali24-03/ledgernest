import type { AuthClient } from '../auth/client';
import type { BankingApi } from './types';

/** Banking backed by the real API, always for one organisation. */
export function createLiveBankingApi(client: AuthClient, organizationId: string): BankingApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/banking${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    accounts: () => r('/accounts'),
    activity: (accountId, from, to) => r(`/accounts/${accountId}/activity?from=${from}&to=${to}`),
    transactions: (q) => {
      const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
      if (q.bankAccountId) p.set('bankAccountId', q.bankAccountId);
      if (q.kind) p.set('kind', q.kind);
      return r(`/transactions?${p}`);
    },
    money: (input) => r('/money', { method: 'POST', json: input }),
    transfer: (input) => r('/transfers', { method: 'POST', json: input }),
    void: (id, reason) => r(`/transactions/${id}/void`, { method: 'POST', json: reason ? { reason } : {} }),
  };
}
