import type { AuthClient } from '../auth/client';
import type { GstSlabsApi, TaxesApi } from './types';

/** Taxes backed by the real API, always for one organisation. */
export function createLiveTaxesApi(client: AuthClient, organizationId: string): TaxesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/taxes${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    setupGst: (slabIds) => r('/gst-setup', { method: 'POST', json: slabIds ? { slabIds } : {} }),
    createRate: (input) => r('/rates', { method: 'POST', json: input }),
    updateRate: (id, patch) => r(`/rates/${id}`, { method: 'PATCH', json: patch }),
    archiveRate: (id, archive) => r(`/rates/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    createGroup: (input) => r('/groups', { method: 'POST', json: input }),
    renameGroup: (id, name) => r(`/groups/${id}`, { method: 'PATCH', json: { name } }),
    archiveGroup: (id, archive) => r(`/groups/${id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' }),
  };
}

export function createLiveGstSlabsApi(client: AuthClient): GstSlabsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/platform/gst-slabs${path}`, init);
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, patch) => r(`/${id}`, { method: 'PATCH', json: patch }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
  };
}
