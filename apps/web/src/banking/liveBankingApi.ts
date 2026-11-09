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
    previewStatement: (input) => r('/statements/preview', { method: 'POST', json: input }),
    importStatement: (input) => r('/statements/import', { method: 'POST', json: input }),
    statementImports: (bankAccountId) => r(`/statements/imports?bankAccountId=${bankAccountId}`),
    statementLines: (q) => {
      const p = new URLSearchParams({ bankAccountId: q.bankAccountId, page: String(q.page), pageSize: String(q.pageSize) });
      if (q.status) p.set('status', q.status);
      return r(`/statements/lines?${p}`);
    },
    undoImport: (id) => r(`/statements/imports/${id}`, { method: 'DELETE' }),
    reconcileWorkspace: (accountId, date) => r(`/reconcile/${accountId}?date=${date}`),
    match: (statementLineId, journalLineIds) => r('/reconcile/match', { method: 'POST', json: { statementLineId, journalLineIds } }),
    unmatch: (statementLineId) => r(`/reconcile/unmatch/${statementLineId}`, { method: 'POST' }),
    ignore: (statementLineId, ignored) => r('/reconcile/ignore', { method: 'POST', json: { statementLineId, ignored } }),
    createFromLine: (input) => r('/reconcile/create', { method: 'POST', json: input }),
    reconcile: (input) => r('/reconciliations', { method: 'POST', json: input }),
    reconciliations: (bankAccountId) => r(`/reconciliations?bankAccountId=${bankAccountId}`),
    undoReconciliation: (id) => r(`/reconciliations/${id}`, { method: 'DELETE' }),
  };
}
