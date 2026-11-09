import type { AuthClient } from '../auth/client';
import type { BudgetsApi } from './types';

/** Budgets backed by the real API, always for one organisation. */
export function createLiveBudgetsApi(client: AuthClient, organizationId: string): BudgetsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/budgets${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    get: (id) => r(`/${id}`),
    create: (input) => r('', { method: 'POST', json: input }),
    setLines: (id, lines) => r(`/${id}/lines`, { method: 'PUT', json: { lines } }),
    rename: (id, name) => r(`/${id}`, { method: 'PATCH', json: { name } }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    comparison: (id, upTo) => r(`/${id}/comparison${upTo ? `?upTo=${upTo}` : ''}`),
  };
}
