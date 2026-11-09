/**
 * Every permission in LedgerNest. Keys are `area.action`.
 * Platform permissions apply across all organisations (Super Admin only);
 * organisation permissions apply inside one organisation.
 */
export const PLATFORM_PERMISSIONS = [
  'platform.organizations.view',
  'platform.organizations.manage',
  'platform.users.view',
  'platform.users.manage',
  'platform.audit.view',
  'platform.settings.manage',
] as const;

export const ORGANIZATION_PERMISSIONS = [
  // organisation
  'org.settings.view',
  'org.settings.manage',
  'org.billing.manage',
  'org.delete',
  // people and access
  'users.view',
  'users.invite',
  'users.manage',
  'roles.view',
  'roles.manage',
  // books
  'accounts.view',
  'accounts.manage',
  'journals.view',
  'journals.create',
  'journals.post',
  'journals.reverse',
  'periods.close',
  'periods.reopen',
  'taxes.manage',
  'currencies.manage',
  // sales and purchases
  'contacts.view',
  'contacts.manage',
  'invoices.view',
  'invoices.manage',
  'bills.view',
  'bills.manage',
  'payments.manage',
  // banking
  'banking.view',
  'banking.manage',
  'banking.reconcile',
  // insight
  'reports.view',
  'reports.export',
  'audit.view',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];
export type Permission = PlatformPermission | OrganizationPermission;

export const ALL_PERMISSIONS: readonly Permission[] = [...PLATFORM_PERMISSIONS, ...ORGANIZATION_PERMISSIONS];

const known = new Set<string>(ALL_PERMISSIONS);
export const isPermission = (value: unknown): value is Permission => typeof value === 'string' && known.has(value);

export const isPlatformPermission = (p: Permission): p is PlatformPermission => p.startsWith('platform.');

/** Group permissions by area for display, e.g. { journals: ['journals.view', ...] }. */
export function groupByArea(perms: readonly Permission[]): Record<string, Permission[]> {
  const out: Record<string, Permission[]> = {};
  for (const p of perms) {
    const area = isPlatformPermission(p) ? 'platform' : p.split('.')[0]!;
    (out[area] ??= []).push(p);
  }
  return out;
}
