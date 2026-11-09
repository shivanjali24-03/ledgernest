import type { AuthClient } from '../auth/client';
import type { ScheduledReportsApi } from './types';

/** Scheduled reports backed by the real API, always for one organisation. */
export function createLiveScheduledReportsApi(client: AuthClient, organizationId: string): ScheduledReportsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/scheduled-reports${path}`, { ...init, headers });
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PATCH', json: input }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    run: (id) => r(`/${id}/run`, { method: 'POST' }),
    runs: (id) => r(`/${id}/deliveries`),
    async file(runId) {
      const { blob, filename } = await client.download(`/scheduled-reports/deliveries/${runId}/file`, { headers });
      return { blob, filename: filename ? decodeURIComponent(filename) : 'report' };
    },
  };
}
