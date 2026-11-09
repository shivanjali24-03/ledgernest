import { ALL_PERMISSIONS, ORGANIZATION_PERMISSIONS, isPermission, type Permission } from './permissions.js';

export type BuiltInRoleId = 'super_admin' | 'owner' | 'admin' | 'accountant' | 'bookkeeper' | 'auditor' | 'viewer';
export type RoleScope = 'platform' | 'organization';

export interface RoleDefinition {
  id: string;
  scope: RoleScope;
  /** Higher rank = more authority. Used to decide who may assign which role. */
  rank: number;
  builtIn: boolean;
  permissions: readonly Permission[];
}

const READ_BOOKS: Permission[] = [
  'org.settings.view',
  'users.view',
  'roles.view',
  'accounts.view',
  'journals.view',
  'contacts.view',
  'invoices.view',
  'bills.view',
  'banking.view',
  'reports.view',
];

const everythingExcept = (...excluded: Permission[]): Permission[] => ORGANIZATION_PERMISSIONS.filter((p) => !excluded.includes(p));

export const BUILT_IN_ROLES: Record<BuiltInRoleId, RoleDefinition> = {
  super_admin: { id: 'super_admin', scope: 'platform', rank: 100, builtIn: true, permissions: ALL_PERMISSIONS },
  owner: { id: 'owner', scope: 'organization', rank: 90, builtIn: true, permissions: [...ORGANIZATION_PERMISSIONS] },
  admin: {
    id: 'admin',
    scope: 'organization',
    rank: 80,
    builtIn: true,
    permissions: everythingExcept('org.billing.manage', 'org.delete'),
  },
  accountant: {
    id: 'accountant',
    scope: 'organization',
    rank: 60,
    builtIn: true,
    permissions: [
      ...READ_BOOKS,
      'accounts.manage',
      'journals.create',
      'journals.post',
      'journals.reverse',
      'periods.close',
      'periods.reopen',
      'taxes.manage',
      'currencies.manage',
      'contacts.manage',
      'invoices.manage',
      'bills.manage',
      'payments.manage',
      'banking.manage',
      'banking.reconcile',
      'reports.export',
      'audit.view',
    ],
  },
  bookkeeper: {
    id: 'bookkeeper',
    scope: 'organization',
    rank: 40,
    builtIn: true,
    permissions: [
      ...READ_BOOKS,
      'journals.create',
      'contacts.manage',
      'invoices.manage',
      'bills.manage',
      'payments.manage',
      'banking.manage',
      'reports.export',
    ],
  },
  auditor: { id: 'auditor', scope: 'organization', rank: 30, builtIn: true, permissions: [...READ_BOOKS, 'reports.export', 'audit.view'] },
  viewer: { id: 'viewer', scope: 'organization', rank: 10, builtIn: true, permissions: ['org.settings.view', 'accounts.view', 'reports.view'] },
};

export const BUILT_IN_ROLE_IDS = Object.keys(BUILT_IN_ROLES) as BuiltInRoleId[];
export const isBuiltInRole = (id: string): id is BuiltInRoleId => id in BUILT_IN_ROLES;

/** Rank given to custom roles: below Admin, so Admins and Owners can always manage them. */
export const CUSTOM_ROLE_RANK = 50;

/** Does this role grant the permission? */
export const can = (role: Pick<RoleDefinition, 'permissions'>, permission: Permission): boolean => role.permissions.includes(permission);

/** Every permission granted by a set of roles (a user can hold a platform role and an organisation role). */
export function permissionsOf(roles: readonly Pick<RoleDefinition, 'permissions'>[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of r.permissions) out.add(p);
  return out;
}

/**
 * The golden rule of access control: nobody can grant more access than they have,
 * and nobody can assign a role at or above their own rank (except the Super Admin).
 */
export function canAssignRole(actor: RoleDefinition, target: RoleDefinition): boolean {
  if (actor.id === 'super_admin') return true;
  if (target.scope === 'platform') return false;
  if (!can(actor, 'users.manage') && !can(actor, 'users.invite')) return false;
  // Owners may hand over or share ownership; everyone else must be strictly above the target
  const rankOk = actor.id === 'owner' ? target.rank <= actor.rank : target.rank < actor.rank;
  return rankOk && target.permissions.every((p) => actor.permissions.includes(p));
}

/** Validate a custom role's permission list: organisation permissions only, no unknown or duplicate keys. */
export function validateCustomRole(input: { name: unknown; permissions: unknown }): { ok: true; permissions: Permission[] } | { ok: false; error: string } {
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 40) {
    return { ok: false, error: 'Role name must be 2–40 characters.' };
  }
  if (!Array.isArray(input.permissions) || input.permissions.length === 0) return { ok: false, error: 'Choose at least one permission.' };
  const unique = [...new Set(input.permissions)];
  const bad = unique.find((p) => !isPermission(p) || p.startsWith('platform.'));
  if (bad !== undefined) return { ok: false, error: `"${String(bad)}" is not an organisation permission.` };
  return { ok: true, permissions: unique as Permission[] };
}
