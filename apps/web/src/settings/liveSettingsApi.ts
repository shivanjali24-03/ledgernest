import { ApiError, type AuthClient } from '../auth/client';
import type { OrganizationSettings, SettingsApi } from './types';

/** Settings backed by the real API, always for one organisation. */
export function createLiveSettingsApi(client: AuthClient, organizationId: string): SettingsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/organization${path}`, { ...init, headers });
  return {
    get: async () => (await r<{ organization: OrganizationSettings }>('')).organization,
    update: (input) => r('', { method: 'PATCH', json: input }),
    setLogo: (upload) => r('/logo', { method: 'PUT', json: upload }),
    removeLogo: () => r('/logo', { method: 'DELETE' }),
    async logo() {
      try {
        return (await client.download('/organization/logo', { headers })).blob;
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'not_found') return null;
        throw e;
      }
    },
  };
}
