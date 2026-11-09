import type { AuthClient } from '../auth/client';
import type { AssetsApi } from './types';

/** Fixed assets backed by the real API, always for one organisation. */
export function createLiveAssetsApi(client: AuthClient, organizationId: string): AssetsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/fixed-assets${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    preview: (upTo) => r(`/depreciation/preview?upTo=${upTo}`),
    run: (upTo) => r('/depreciation/runs', { method: 'POST', json: { upTo } }),
    runs: () => r('/depreciation/runs'),
    undoRun: (id) => r(`/depreciation/runs/${id}`, { method: 'DELETE' }),
    dispose: (id, input) => r(`/${id}/dispose`, { method: 'POST', json: input }),
    schedule: (from, to) => r(`/schedule?from=${from}&to=${to}`),
  };
}
