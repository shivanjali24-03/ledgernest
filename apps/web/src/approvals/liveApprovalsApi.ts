import type { AuthClient } from '../auth/client';
import type { ApprovalsApi } from './types';

/** Approvals backed by the real API, always for one organisation. */
export function createLiveApprovalsApi(client: AuthClient, organizationId: string): ApprovalsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/approvals${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    rules: () => r('/rules'),
    setRule: (documentType, minAmount) => r(`/rules/${documentType}`, { method: 'PUT', json: { minAmount } }),
    removeRule: (documentType) => r(`/rules/${documentType}`, { method: 'DELETE' }),
    list: (status) => r(status ? `?status=${status}` : ''),
    approve: (id, note) => r(`/${id}/approve`, { method: 'POST', json: note ? { note } : {} }),
    reject: (id, note) => r(`/${id}/reject`, { method: 'POST', json: { note } }),
    cancel: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
