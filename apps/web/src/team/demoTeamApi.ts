import {
  BUILT_IN_ROLES,
  ORGANIZATION_ROLE_IDS,
  canAssignRole,
  customRoleDefinition,
  customRoleSchema,
  customRoleUpdateSchema,
  inviteMemberSchema,
  type BuiltInRoleId,
  type OrganizationPermission,
  type RoleChoice,
  type RoleDefinition,
} from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { InviteResult, Member, MemberRole, PendingInvitation, RolesResponse, TeamApi } from './types';

/**
 * Team management in demo mode, for the sample company. It applies the same shared rules
 * as the API to whichever role you're previewing, so "preview as Admin" shows exactly
 * what an Admin may and may not do.
 */

// v2: role ids became UUIDs (they must pass the same validation as real ones); older saved demos start fresh
const KEY = 'ledgernest.demo.team.v2';
const CASHIER = 'b0000000-0000-4000-8000-000000000001';
const TAX_CONSULTANT = 'b0000000-0000-4000-8000-000000000002';
const DAY = 86_400_000;
const ME = 'm-1';

interface StoredMember extends Omit<Member, 'role'> {
  builtInRole: string | null;
  customRoleId: string | null;
}
interface StoredRole {
  id: string;
  name: string;
  description: string | null;
  permissions: OrganizationPermission[];
}
interface StoredInvitation {
  id: string;
  email: string;
  builtInRole: string | null;
  customRoleId: string | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}
interface State {
  members: StoredMember[];
  roles: StoredRole[];
  invitations: StoredInvitation[];
}

const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function seed(): State {
  const m = (id: string, name: string, email: string, builtInRole: string | null, customRoleId: string | null, joined: number, seen: number | null): StoredMember => ({
    id,
    user: { id: `u-${id}`, name, email, status: 'ACTIVE', lastLoginAt: seen === null ? null : ago(seen) },
    builtInRole,
    customRoleId,
    joinedAt: ago(joined),
  });
  return {
    members: [
      m(ME, 'Shivanjali Desai', 'admin@ledgernest.demo', 'owner', null, 240, 0),
      m('m-2', 'Rohan Mehta', 'rohan@nestdemo.in', 'admin', null, 200, 1),
      m('m-3', 'Priya Nair', 'priya@nestdemo.in', 'accountant', null, 160, 0),
      m('m-4', 'Arjun Kulkarni', 'arjun@nestdemo.in', 'bookkeeper', null, 120, 2),
      m('m-5', 'Fatima Sheikh', 'fatima@auditpartners.in', 'auditor', null, 60, 9),
      m('m-6', 'Vikram Singh', 'vikram@nestdemo.in', 'viewer', null, 30, null),
      m('m-7', 'Neha Gupta', 'neha@nestdemo.in', null, CASHIER, 20, 3),
    ],
    roles: [
      { id: CASHIER, name: 'Branch cashier', description: 'Records receipts and payments at the branch.', permissions: ['banking.view', 'banking.manage', 'payments.manage', 'contacts.view', 'invoices.view'] },
      { id: TAX_CONSULTANT, name: 'Tax consultant', description: 'Prepares tax filings from the books.', permissions: ['accounts.view', 'journals.view', 'reports.view', 'reports.export', 'taxes.manage'] },
    ],
    invitations: [
      { id: 'i-1', email: 'kabir@nestdemo.in', builtInRole: 'accountant', customRoleId: null, invitedBy: 'Rohan Mehta', createdAt: ago(4), expiresAt: ahead(3) },
      { id: 'i-2', email: 'temp.staff@agency.in', builtInRole: 'viewer', customRoleId: null, invitedBy: 'Shivanjali Desai', createdAt: ago(12), expiresAt: ago(5) },
    ],
  };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fresh sample data */
  }
  return seed();
}

export function resetDemoTeam() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const fail = (kind: ConstructorParameters<typeof ApiError>[0], status: number, message: string, details?: Record<string, unknown>): never => {
  throw new ApiError(kind, status, message, undefined, details);
};

export function createDemoTeamApi(actorRole: () => BuiltInRoleId, { latencyMs = import.meta.env.MODE === 'test' ? 0 : 250 } = {}): TeamApi {
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  };
  const wait = <T>(fn: () => T): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          state = load();
          const out = fn();
          save();
          resolve(structuredClone(out));
        } catch (e) {
          reject(e as Error);
        }
      }, latencyMs),
    );

  const actor = (): RoleDefinition => BUILT_IN_ROLES[actorRole()];
  const roleById = (id: string) => state.roles.find((r) => r.id === id) ?? fail('not_found', 404, 'Role not found.');
  const defOf = (builtInRole: string | null, customRoleId: string | null): RoleDefinition =>
    builtInRole ? BUILT_IN_ROLES[builtInRole as BuiltInRoleId] : customRoleDefinition(customRoleId!, roleById(customRoleId!).permissions);
  const assertCanAssign = (target: RoleDefinition) => {
    const mine = actor();
    if (!canAssignRole(mine, target)) {
      const missing = target.permissions.filter((p) => !mine.permissions.includes(p));
      fail('forbidden', 403, "You can't give a role with more access than your own.", { reason: 'exceeds_your_access', ...(missing.length && { missing }) });
    }
  };
  const resolve = (choice: RoleChoice) =>
    'builtInRole' in choice
      ? { def: BUILT_IN_ROLES[choice.builtInRole], builtInRole: choice.builtInRole as string | null, customRoleId: null as string | null }
      : { def: customRoleDefinition(choice.customRoleId, roleById(choice.customRoleId).permissions), builtInRole: null, customRoleId: choice.customRoleId };
  const roleView = (builtInRole: string | null, customRoleId: string | null): MemberRole =>
    builtInRole ? { type: 'built_in', key: builtInRole } : { type: 'custom', id: customRoleId ?? undefined, name: state.roles.find((r) => r.id === customRoleId)?.name };
  const findMember = (id: string) => state.members.find((m) => m.id === id) ?? fail('not_found', 404, 'Member not found.');
  const assertNotLastOwner = (id: string) => {
    if (!state.members.some((m) => m.id !== id && m.builtInRole === 'owner')) fail('conflict', 409, 'Every organisation needs at least one Owner.', { reason: 'last_owner' });
  };
  const newInvite = (email: string, builtInRole: string | null, customRoleId: string | null): InviteResult => {
    const inv: StoredInvitation = { id: `i-${crypto.randomUUID()}`, email, builtInRole, customRoleId, invitedBy: 'Shivanjali Desai', createdAt: new Date().toISOString(), expiresAt: ahead(7) };
    state.invitations.unshift(inv);
    return { id: inv.id, email, inviteUrl: `${location.origin}${import.meta.env.BASE_URL}accept-invite?token=demo-${crypto.randomUUID()}`, expiresAt: inv.expiresAt };
  };
  const assertWithinMyAccess = (permissions: readonly string[]) => {
    const missing = permissions.filter((p) => !actor().permissions.includes(p as OrganizationPermission));
    if (missing.length) fail('forbidden', 403, "A role can't include access you don't have.", { reason: 'exceeds_your_access', missing });
  };
  const assertNameFree = (name: string, except?: string) => {
    if (state.roles.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase())) fail('conflict', 409, 'A role with this name already exists.', { reason: 'name_taken' });
  };

  return {
    listMembers: () => wait(() => state.members.map(({ builtInRole, customRoleId, ...m }) => ({ ...m, role: roleView(builtInRole, customRoleId) }))),

    changeRole: (id, choice) =>
      wait(() => {
        const m = findMember(id);
        if (id === ME) fail('validation', 400, "You can't change your own role.", { reason: 'self' });
        assertCanAssign(defOf(m.builtInRole, m.customRoleId));
        const next = resolve(choice);
        assertCanAssign(next.def);
        if (m.builtInRole === 'owner' && next.builtInRole !== 'owner') assertNotLastOwner(id);
        m.builtInRole = next.builtInRole;
        m.customRoleId = next.customRoleId;
        return { id };
      }),

    removeMember: (id) =>
      wait(() => {
        const m = findMember(id);
        if (id === ME) fail('validation', 400, "You can't remove yourself.", { reason: 'self' });
        assertCanAssign(defOf(m.builtInRole, m.customRoleId));
        if (m.builtInRole === 'owner') assertNotLastOwner(id);
        state.members = state.members.filter((x) => x.id !== id);
      }),

    listInvitations: () =>
      wait((): PendingInvitation[] =>
        state.invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: roleView(i.builtInRole, i.customRoleId),
          invitedBy: i.invitedBy,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          expired: Date.parse(i.expiresAt) <= Date.now(),
        })),
      ),

    invite: (rawEmail, choice) =>
      wait(() => {
        const parsed = inviteMemberSchema.safeParse({ email: rawEmail, role: choice });
        if (!parsed.success) fail('validation', 400, 'Some fields are not valid.');
        const email = parsed.data!.email;
        const next = resolve(choice);
        assertCanAssign(next.def);
        if (state.members.some((m) => m.user.email === email)) fail('conflict', 409, 'Already a member.', { reason: 'already_member' });
        if (state.invitations.some((i) => i.email === email && Date.parse(i.expiresAt) > Date.now())) fail('conflict', 409, 'Already invited.', { reason: 'already_invited' });
        return newInvite(email, next.builtInRole, next.customRoleId);
      }),

    resend: (id) =>
      wait(() => {
        const old = state.invitations.find((i) => i.id === id) ?? fail('not_found', 404, 'Invitation not found.');
        assertCanAssign(defOf(old.builtInRole, old.customRoleId));
        state.invitations = state.invitations.filter((i) => i.id !== id);
        return newInvite(old.email, old.builtInRole, old.customRoleId);
      }),

    revoke: (id) =>
      wait(() => {
        const inv = state.invitations.find((i) => i.id === id) ?? fail('not_found', 404, 'Invitation not found.');
        assertCanAssign(defOf(inv.builtInRole, inv.customRoleId));
        state.invitations = state.invitations.filter((i) => i.id !== id);
      }),

    listRoles: () =>
      wait((): RolesResponse => {
        const mine = actor();
        return {
          builtIn: ORGANIZATION_ROLE_IDS.map((key) => ({
            type: 'built_in' as const,
            key,
            permissions: [...BUILT_IN_ROLES[key].permissions] as OrganizationPermission[],
            memberCount: state.members.filter((m) => m.builtInRole === key).length,
            canAssign: canAssignRole(mine, BUILT_IN_ROLES[key]),
          })),
          custom: [...state.roles]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => ({ type: 'custom' as const, ...r, memberCount: state.members.filter((m) => m.customRoleId === r.id).length, canAssign: canAssignRole(mine, customRoleDefinition(r.id, r.permissions)) })),
        };
      }),

    createRole: (raw) =>
      wait(() => {
        const parsed = customRoleSchema.safeParse(raw);
        if (!parsed.success) fail('validation', 400, 'Some fields are not valid.');
        const input = parsed.data!;
        assertWithinMyAccess(input.permissions);
        assertNameFree(input.name);
        const role: StoredRole = { id: crypto.randomUUID(), name: input.name, description: input.description ?? null, permissions: input.permissions };
        state.roles.push(role);
        return role;
      }),

    updateRole: (id, raw) =>
      wait(() => {
        const parsed = customRoleUpdateSchema.safeParse(raw);
        if (!parsed.success) fail('validation', 400, 'Some fields are not valid.');
        const role = roleById(id);
        assertCanAssign(customRoleDefinition(role.id, role.permissions));
        const input = parsed.data!;
        if (input.permissions) assertWithinMyAccess(input.permissions);
        if (input.name) assertNameFree(input.name, id);
        Object.assign(role, { ...input, description: input.description === undefined ? role.description : input.description });
        return role;
      }),

    deleteRole: (id) =>
      wait(() => {
        const role = roleById(id);
        assertCanAssign(customRoleDefinition(role.id, role.permissions));
        const inUse = state.members.filter((m) => m.customRoleId === id).length;
        if (inUse) fail('conflict', 409, 'People still have this role.', { reason: 'in_use', memberCount: inUse });
        state.roles = state.roles.filter((r) => r.id !== id);
        state.invitations = state.invitations.filter((i) => i.customRoleId !== id);
      }),
  };
}
