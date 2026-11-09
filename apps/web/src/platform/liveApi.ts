import type { AuthClient } from '../auth/client';
import type { ListQuery, PlatformApi } from './types';

const qs = (q: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** The console backed by the real API. */
export function createLivePlatformApi(client: AuthClient): PlatformApi {
  const r = client.request;
  return {
    stats: () => r('/platform/stats'),
    listOrganizations: (q: ListQuery) => r(`/platform/organizations${qs({ ...q })}`),
    getOrganization: (id) => r(`/platform/organizations/${id}`),
    createOrganization: (input) => r('/platform/organizations', { method: 'POST', json: input }),
    updateOrganization: (id, input) => r(`/platform/organizations/${id}`, { method: 'PATCH', json: input }),
    setOrganizationStatus: (id, action, reason) => r(`/platform/organizations/${id}/${action}`, { method: 'POST', json: reason ? { reason } : {} }),
    listUsers: (q) => r(`/platform/users${qs({ ...q })}`),
    userAction: (id, action, reason) => r(`/platform/users/${id}/${action}`, { method: 'POST', json: reason ? { reason } : {} }),
    previewInvitation: (token) => r('/invitations/preview', { method: 'POST', json: { token } }),
    acceptInvitationSignedIn: (token) => r('/invitations/accept-signed-in', { method: 'POST', json: { token } }),
  };
}
