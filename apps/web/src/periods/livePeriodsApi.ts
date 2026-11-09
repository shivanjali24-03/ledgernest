import type { AuthClient } from '../auth/client';
import type { PeriodsApi } from './types';

/** Financial years backed by the real API, always for one organisation. */
export function createLivePeriodsApi(client: AuthClient, organizationId: string): PeriodsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/fiscal-years${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    createYear: (startYear) => r('', { method: 'POST', json: { startYear } }),
    close: (id, reason) => r(`/periods/${id}/close`, { method: 'POST', json: reason ? { reason } : {} }),
    reopen: (id, reason) => r(`/periods/${id}/reopen`, { method: 'POST', json: reason ? { reason } : {} }),
    yearEnd: (yearId) => r(`/${yearId}/year-end`),
  };
}
