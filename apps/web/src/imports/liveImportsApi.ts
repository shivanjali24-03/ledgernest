import type { AuthClient } from '../auth/client';
import type { ImportsApi } from './types';

/** Imports backed by the real API, always for one organisation. */
export function createLiveImportsApi(client: AuthClient, organizationId: string): ImportsApi {
  const r = <T>(path: string, json: unknown) => client.request<T>(`/imports${path}`, { method: 'POST', json, headers: { 'X-Organization-Id': organizationId } });
  return {
    preview: (kind, rows, date) => r(`/${kind}/preview`, { rows, ...(date && { date }) }),
    run: (kind, rows, date) => r(`/${kind}`, { rows, ...(date && { date }) }),
  };
}
