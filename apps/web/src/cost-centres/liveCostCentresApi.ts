import type { AuthClient } from '../auth/client';
import type { CostCentresApi } from './types';

/** Cost centres backed by the real API, always for one organisation. */
export function createLiveCostCentresApi(client: AuthClient, organizationId: string): CostCentresApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/cost-centres${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: (includeArchived) => r(includeArchived ? '?archived=true' : ''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    archive: (id, archived) => r(`/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
