import { BUILT_IN_ROLES, isBuiltInRole, isPermission, isPlatformPermission, type OrganizationPermission } from '@ledgernest/shared';

/**
 * What a membership allows inside its organisation.
 * Platform permissions are never granted through a membership, even if one is stored on a custom role.
 */
export function membershipPermissions(m: { builtInRole: string | null; customRole: { permissions: string[] } | null }): Set<OrganizationPermission> {
  const raw = m.builtInRole && isBuiltInRole(m.builtInRole) ? BUILT_IN_ROLES[m.builtInRole].permissions : (m.customRole?.permissions ?? []);
  return new Set(raw.filter(isPermission).filter((p): p is OrganizationPermission => !isPlatformPermission(p)));
}
