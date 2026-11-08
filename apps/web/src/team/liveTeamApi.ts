import type { AuthClient } from '../auth/client';
import type { TeamApi } from './types';

/** Team management backed by the real API, always for one organisation. */
export function createLiveTeamApi(client: AuthClient, organizationId: string): TeamApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) =>
    client.request<T>(`/organization${path}`, { ...init, headers: { 'X-Organization-Id': organizationId, ...(init.headers as Record<string, string>) } });
  return {
    listMembers: () => r('/members'),
    changeRole: (id, role) => r(`/members/${id}`, { method: 'PATCH', json: { role } }),
    removeMember: (id) => r(`/members/${id}`, { method: 'DELETE' }),
    listInvitations: () => r('/invitations'),
    invite: (email, role) => r('/invitations', { method: 'POST', json: { email, role } }),
    resend: (id) => r(`/invitations/${id}/resend`, { method: 'POST' }),
    revoke: (id) => r(`/invitations/${id}`, { method: 'DELETE' }),
    listRoles: () => r('/roles'),
    createRole: (input) => r('/roles', { method: 'POST', json: input }),
    updateRole: (id, input) => r(`/roles/${id}`, { method: 'PATCH', json: input }),
    deleteRole: (id) => r(`/roles/${id}`, { method: 'DELETE' }),
  };
}
