import { useQuery } from '@tanstack/react-query';
import { BUILT_IN_ROLES, ORGANIZATION_ROLE_IDS, canAssignRole, type OrganizationPermission } from '@ledgernest/shared';
import { useSession } from '../layout/session';
import type { RolesResponse } from './types';
import { useTeamApi } from './useTeamApi';

/** Cache keys include the organisation and (for the demo's role preview) the acting role. */
export function useTeamKey() {
  const s = useSession();
  return ['team', s.organizationId, s.role ?? s.customRoleName] as const;
}

export function useMembers() {
  const api = useTeamApi();
  const key = useTeamKey();
  return useQuery({ queryKey: [...key, 'members'], queryFn: () => api!.listMembers(), enabled: !!api });
}

export function useInvitations() {
  const api = useTeamApi();
  const key = useTeamKey();
  return useQuery({ queryKey: [...key, 'invitations'], queryFn: () => api!.listInvitations(), enabled: !!api });
}

/**
 * Roles to choose from. People who can't view roles still get the built-in ones,
 * worked out with the same shared rule the API uses.
 */
export function useRoles() {
  const api = useTeamApi();
  const key = useTeamKey();
  const session = useSession();
  const canView = session.permissions.has('roles.view');
  const query = useQuery({ queryKey: [...key, 'roles'], queryFn: () => api!.listRoles(), enabled: canView && !!api });
  if (canView) return query;
  const mine = session.role ? BUILT_IN_ROLES[session.role] : null;
  const fallback: RolesResponse = {
    builtIn: ORGANIZATION_ROLE_IDS.map((k) => ({
      type: 'built_in',
      key: k,
      permissions: [...BUILT_IN_ROLES[k].permissions] as OrganizationPermission[],
      memberCount: 0,
      canAssign: !!mine && canAssignRole(mine, BUILT_IN_ROLES[k]),
    })),
    custom: [],
  };
  return { ...query, data: fallback, isPending: false as const, isError: false as const };
}
