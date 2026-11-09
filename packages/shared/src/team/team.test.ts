import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES, canAssignRole } from '../access/roles.js';
import { customRoleDefinition, customRoleSchema, inviteMemberSchema, roleChoiceSchema } from './index.js';

describe('role choices', () => {
  it('accepts organisation roles and custom role ids, never Super Admin', () => {
    expect(roleChoiceSchema.safeParse({ builtInRole: 'viewer' }).success).toBe(true);
    expect(roleChoiceSchema.safeParse({ customRoleId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(roleChoiceSchema.safeParse({ builtInRole: 'super_admin' }).success).toBe(false);
    expect(roleChoiceSchema.safeParse({ builtInRole: 'viewer', customRoleId: '00000000-0000-4000-8000-000000000001' }).success).toBe(false);
  });

  it('normalises invite emails', () => {
    expect(inviteMemberSchema.parse({ email: ' Asha@Acme.IN ', role: { builtInRole: 'viewer' } }).email).toBe('asha@acme.in');
  });
});

describe('custom roles', () => {
  it('only allows organisation permissions, without duplicates', () => {
    expect(customRoleSchema.parse({ name: 'Cashier', permissions: ['banking.view', 'banking.view'] }).permissions).toEqual(['banking.view']);
    expect(customRoleSchema.safeParse({ name: 'Sneaky', permissions: ['platform.users.manage'] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: 'Empty', permissions: [] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: 'X', permissions: ['banking.view'] }).success).toBe(false);
  });

  it('sit below Admin: Admins can assign them, they cannot assign each other', () => {
    const cashier = customRoleDefinition('r1', ['banking.view', 'users.manage']);
    expect(canAssignRole(BUILT_IN_ROLES.admin, customRoleDefinition('r2', ['banking.view']))).toBe(true);
    expect(canAssignRole(cashier, customRoleDefinition('r2', ['banking.view']))).toBe(false);
    expect(canAssignRole(cashier, BUILT_IN_ROLES.viewer)).toBe(false); // viewer has permissions the cashier lacks
  });
});
