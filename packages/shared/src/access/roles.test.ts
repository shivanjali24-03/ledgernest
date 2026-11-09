import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ORGANIZATION_PERMISSIONS, PLATFORM_PERMISSIONS, groupByArea, isPermission } from './permissions.js';
import { BUILT_IN_ROLES, BUILT_IN_ROLE_IDS, CUSTOM_ROLE_RANK, can, canAssignRole, permissionsOf, validateCustomRole, type RoleDefinition } from './roles.js';

const R = BUILT_IN_ROLES;
const custom = (permissions: RoleDefinition['permissions']): RoleDefinition => ({
  id: 'custom_sales',
  scope: 'organization',
  rank: CUSTOM_ROLE_RANK,
  builtIn: false,
  permissions,
});

describe('permissions', () => {
  it('has no duplicate keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('recognises known keys only', () => {
    expect(isPermission('journals.post')).toBe(true);
    expect(isPermission('journals.delete')).toBe(false);
    expect(isPermission(42)).toBe(false);
  });

  it('groups permissions by area', () => {
    const g = groupByArea(ALL_PERMISSIONS);
    expect(g.platform).toHaveLength(PLATFORM_PERMISSIONS.length);
    expect(g.journals).toContain('journals.post');
  });
});

describe('built-in roles', () => {
  it('Super Admin has every permission, including the platform ones', () => {
    for (const p of ALL_PERMISSIONS) expect(can(R.super_admin, p)).toBe(true);
  });

  it('only the Super Admin has platform permissions', () => {
    for (const id of BUILT_IN_ROLE_IDS.filter((r) => r !== 'super_admin')) {
      for (const p of PLATFORM_PERMISSIONS) expect(can(R[id], p)).toBe(false);
    }
  });

  it('Owner has every organisation permission', () => {
    for (const p of ORGANIZATION_PERMISSIONS) expect(can(R.owner, p)).toBe(true);
  });

  it('Admin cannot delete the organisation or manage billing', () => {
    expect(can(R.admin, 'org.delete')).toBe(false);
    expect(can(R.admin, 'org.billing.manage')).toBe(false);
    expect(can(R.admin, 'users.manage')).toBe(true);
  });

  it('Accountant can post and close periods, but not manage users', () => {
    expect(can(R.accountant, 'journals.post')).toBe(true);
    expect(can(R.accountant, 'periods.close')).toBe(true);
    expect(can(R.accountant, 'users.manage')).toBe(false);
  });

  it('Bookkeeper can create but not post journals, and cannot close periods', () => {
    expect(can(R.bookkeeper, 'journals.create')).toBe(true);
    expect(can(R.bookkeeper, 'journals.post')).toBe(false);
    expect(can(R.bookkeeper, 'periods.close')).toBe(false);
  });

  it('Auditor and Viewer are read-only', () => {
    for (const id of ['auditor', 'viewer'] as const) {
      const writes = R[id].permissions.filter((p) => !/\.(view|export)$/.test(p));
      expect(writes).toEqual([]);
    }
    expect(can(R.auditor, 'audit.view')).toBe(true);
    expect(can(R.viewer, 'audit.view')).toBe(false);
  });

  it('ranks descend from Super Admin to Viewer', () => {
    const ranks = BUILT_IN_ROLE_IDS.map((id) => R[id].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('combines permissions from several roles', () => {
    const p = permissionsOf([R.viewer, R.auditor]);
    expect(p.has('audit.view')).toBe(true);
    expect(p.has('journals.post')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('Super Admin can assign any role', () => {
    for (const id of BUILT_IN_ROLE_IDS) expect(canAssignRole(R.super_admin, R[id])).toBe(true);
  });

  it('nobody else can assign the Super Admin role', () => {
    for (const id of BUILT_IN_ROLE_IDS.filter((r) => r !== 'super_admin')) expect(canAssignRole(R[id], R.super_admin)).toBe(false);
  });

  it('Owner can assign Owner (share ownership) and every lower role', () => {
    for (const id of ['owner', 'admin', 'accountant', 'bookkeeper', 'auditor', 'viewer'] as const) {
      expect(canAssignRole(R.owner, R[id])).toBe(true);
    }
  });

  it('Admin can assign roles below Admin, but not Admin or Owner', () => {
    expect(canAssignRole(R.admin, R.accountant)).toBe(true);
    expect(canAssignRole(R.admin, R.admin)).toBe(false);
    expect(canAssignRole(R.admin, R.owner)).toBe(false);
  });

  it('roles without user-management permissions cannot assign anything', () => {
    expect(canAssignRole(R.accountant, R.viewer)).toBe(false);
    expect(canAssignRole(R.viewer, R.viewer)).toBe(false);
  });

  it('nobody can grant permissions they do not have, even through a custom role', () => {
    const withBilling = custom(['reports.view', 'org.billing.manage']);
    expect(canAssignRole(R.admin, withBilling)).toBe(false); // Admin lacks billing
    expect(canAssignRole(R.owner, withBilling)).toBe(true);
    expect(canAssignRole(R.admin, custom(['reports.view', 'invoices.manage']))).toBe(true);
  });
});

describe('validateCustomRole', () => {
  it('accepts organisation permissions and removes duplicates', () => {
    const r = validateCustomRole({ name: 'Sales clerk', permissions: ['invoices.view', 'invoices.manage', 'invoices.view'] });
    expect(r).toEqual({ ok: true, permissions: ['invoices.view', 'invoices.manage'] });
  });

  it.each([
    [{ name: 'x', permissions: ['invoices.view'] }, 'name'],
    [{ name: 'Sales', permissions: [] }, 'at least one'],
    [{ name: 'Sales', permissions: ['invoices.fly'] }, 'not an organisation permission'],
    [{ name: 'Sales', permissions: ['platform.users.manage'] }, 'not an organisation permission'],
  ])('rejects %j', (input, message) => {
    const r = validateCustomRole(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});
