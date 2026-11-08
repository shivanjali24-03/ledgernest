import { organizationCreateSchema, organizationUpdateSchema, slugify } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { ActivityItem, InvitationPreview, Organization, OrganizationDetail, OrganizationRow, Page, PlatformApi, PlatformUser, Status, UserAction } from './types';

/**
 * The console in demo mode: realistic sample data that lives in this browser only.
 * It follows the same rules as the real API, so the demo behaves like the product.
 */

const KEY = 'ledgernest.demo.platform';
const DAY = 86_400_000;
/** The demo Super Admin (matches the demo session) */
export const DEMO_ACTOR = { id: 'u-demo', name: 'Shivanjali Desai', email: 'admin@ledgernest.demo' };

interface Invitation {
  token: string;
  organizationId: string;
  email: string;
  expiresAt: string;
  acceptedAt?: string;
}
interface Membership {
  userId: string;
  organizationId: string;
  role: string;
}
interface State {
  organizations: Organization[];
  users: PlatformUser[];
  memberships: Membership[];
  invitations: Invitation[];
  activity: ActivityItem[];
}

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

function seed(): State {
  const org = (i: number, name: string, extra: Partial<Organization> = {}): Organization => ({
    id: `o-${i}`,
    name,
    slug: slugify(name),
    status: 'ACTIVE',
    baseCurrency: 'INR',
    locale: 'en-IN',
    country: 'IN',
    fiscalYearStartMonth: 4,
    createdAt: ago(200 - i * 25),
    ...extra,
  });
  const organizations = [
    org(1, 'Nest Demo Pvt. Ltd.'),
    org(2, 'Shree Ganesh Traders'),
    org(3, 'Bluewave Clinics'),
    org(4, 'Atlas Learning Academy', { baseCurrency: 'USD', locale: 'en-US', country: 'US', fiscalYearStartMonth: 1 }),
    org(5, 'Café Lumière', { baseCurrency: 'EUR', locale: 'fr-FR', country: 'FR', fiscalYearStartMonth: 1 }),
    org(6, 'Al Noor Trading LLC', { baseCurrency: 'AED', locale: 'ar-AE', country: 'AE', fiscalYearStartMonth: 1, status: 'SUSPENDED' }),
    org(7, 'GreenRoots Foundation', { createdAt: ago(6) }),
  ];
  const user = (i: number, name: string, email: string, extra: Partial<PlatformUser> = {}): PlatformUser => ({
    id: `u-${i}`,
    name,
    email,
    status: 'ACTIVE',
    isSuperAdmin: false,
    lastLoginAt: ago(i % 5),
    createdAt: ago(180 - i * 10),
    organizationCount: 0,
    ...extra,
  });
  const users = [
    { ...DEMO_ACTOR, status: 'ACTIVE' as Status, isSuperAdmin: true, lastLoginAt: ago(0), createdAt: ago(240), organizationCount: 1 },
    user(2, 'Rohan Mehta', 'rohan@ledgernest.demo', { isSuperAdmin: true }),
    user(3, 'Asha Rao', 'asha@shreeganesh.in'),
    user(4, 'Dr. Kavya Iyer', 'kavya@bluewave.health'),
    user(5, 'Daniel Brooks', 'daniel@atlaslearning.org'),
    user(6, 'Camille Laurent', 'camille@cafelumiere.fr'),
    user(7, 'Omar Haddad', 'omar@alnoor.ae', { status: 'SUSPENDED', lastLoginAt: ago(40) }),
    user(8, 'Meera Joshi', 'meera@greenroots.org', { lastLoginAt: null }),
  ];
  const memberships: Membership[] = [
    { userId: 'u-demo', organizationId: 'o-1', role: 'owner' },
    { userId: 'u-3', organizationId: 'o-2', role: 'owner' },
    { userId: 'u-4', organizationId: 'o-3', role: 'owner' },
    { userId: 'u-5', organizationId: 'o-4', role: 'owner' },
    { userId: 'u-6', organizationId: 'o-5', role: 'owner' },
    { userId: 'u-7', organizationId: 'o-6', role: 'owner' },
    { userId: 'u-3', organizationId: 'o-3', role: 'accountant' },
  ];
  const actor = { name: DEMO_ACTOR.name, email: DEMO_ACTOR.email };
  const activity: ActivityItem[] = [
    { id: 'a-1', action: 'platform.organization.create', createdAt: ago(6), entityType: 'organization', entityId: 'o-7', actor, organization: { id: 'o-7', name: 'GreenRoots Foundation' } },
    { id: 'a-2', action: 'platform.organization.suspend', createdAt: ago(12), entityType: 'organization', entityId: 'o-6', actor, organization: { id: 'o-6', name: 'Al Noor Trading LLC' } },
    { id: 'a-3', action: 'platform.user.suspend', createdAt: ago(12), entityType: 'user', entityId: 'u-7', actor, organization: null },
    { id: 'a-4', action: 'platform.user.promote', createdAt: ago(30), entityType: 'user', entityId: 'u-2', actor, organization: null },
  ];
  return {
    organizations,
    users,
    memberships,
    invitations: [{ token: 'demo-greenroots-owner', organizationId: 'o-7', email: 'meera@greenroots.org', expiresAt: new Date(Date.now() + 5 * DAY).toISOString() }],
    activity,
  };
}
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through to fresh sample data */
  }
  return seed();
}

export function createDemoPlatformApi({ latencyMs = 250 }: { latencyMs?: number } = {}): PlatformApi {
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode: changes last until reload */
    }
  };
  const wait = <T>(fn: () => T): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(structuredClone(fn()));
        } catch (e) {
          reject(e as Error);
        }
      }, latencyMs),
    );
  const fail = (kind: ConstructorParameters<typeof ApiError>[0], status: number, message: string, details?: Record<string, unknown>) => {
    throw new ApiError(kind, status, message, undefined, details);
  };
  const log = (action: string, entityType: string, entityId: string, organization: ActivityItem['organization']) => {
    state.activity.unshift({ id: id('a'), action, createdAt: new Date().toISOString(), entityType, entityId, actor: { name: DEMO_ACTOR.name, email: DEMO_ACTOR.email }, organization });
  };
  const findOrg = (orgId: string) => state.organizations.find((o) => o.id === orgId) ?? fail('not_found', 404, 'Organisation not found.');
  const findUser = (userId: string) => state.users.find((u) => u.id === userId) ?? fail('not_found', 404, 'User not found.');
  const memberCount = (orgId: string) => state.memberships.filter((m) => m.organizationId === orgId).length;
  const recount = () => {
    for (const u of state.users) u.organizationCount = state.memberships.filter((m) => m.userId === u.id).length;
  };
  const page = <T>(items: T[], p = 1, size = 25): Page<T> => ({ items: items.slice((p - 1) * size, p * size), page: p, pageSize: size, total: items.length });
  const matches = (text: string, q?: string) => !q || text.toLowerCase().includes(q.trim().toLowerCase());
  const inviteUrl = (token: string) => `${location.origin}${import.meta.env.BASE_URL}accept-invite?token=${token}`;

  return {
    stats: () =>
      wait(() => {
        const count = <T extends { status: Status }>(xs: T[]) => ({ total: xs.length, active: xs.filter((x) => x.status === 'ACTIVE').length, suspended: xs.filter((x) => x.status === 'SUSPENDED').length });
        return {
          organizations: { ...count(state.organizations), newLast30Days: state.organizations.filter((o) => Date.parse(o.createdAt) > Date.now() - 30 * DAY).length },
          users: { ...count(state.users), superAdmins: state.users.filter((u) => u.isSuperAdmin && u.status === 'ACTIVE').length },
          activity: { signInsLast7Days: 48, failedSignInsLast7Days: 3 },
          recent: state.activity.slice(0, 10),
        };
      }),

    listOrganizations: (q) =>
      wait(() => {
        const rows: OrganizationRow[] = [...state.organizations]
          .filter((o) => (!q.status || o.status === q.status) && (matches(o.name, q.search) || matches(o.slug, q.search)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((o) => ({ ...o, memberCount: memberCount(o.id) }));
        return page(rows, q.page, q.pageSize);
      }),

    getOrganization: (orgId) =>
      wait((): OrganizationDetail => {
        const o = findOrg(orgId);
        const owners = state.memberships
          .filter((m) => m.organizationId === orgId && m.role === 'owner')
          .map((m) => findUser(m.userId))
          .map(({ id: uid, name, email }) => ({ id: uid, name, email }));
        const pendingInvitations = state.invitations
          .filter((i) => i.organizationId === orgId && !i.acceptedAt && Date.parse(i.expiresAt) > Date.now())
          .map((i) => ({ id: i.token, email: i.email, builtInRole: 'owner', expiresAt: i.expiresAt, createdAt: o.createdAt }));
        return { ...o, memberCount: memberCount(orgId), owners, pendingInvitations };
      }),

    createOrganization: (raw) =>
      wait(() => {
        const parsed = organizationCreateSchema.safeParse(raw);
        if (!parsed.success) fail('validation', 400, 'Some fields are not valid.', { fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
        const input = parsed.data!;
        const taken = new Set(state.organizations.map((o) => o.slug));
        let slug = input.slug ?? (slugify(input.name) || 'organisation');
        if (input.slug && taken.has(slug)) fail('conflict', 409, 'That web address is taken. Try another.', { field: 'slug' });
        for (let n = 2; taken.has(slug); n++) slug = `${(slugify(input.name) || 'organisation').slice(0, 44)}-${n}`;

        const org: Organization = {
          id: id('o'),
          name: input.name,
          slug,
          status: 'ACTIVE',
          baseCurrency: input.baseCurrency,
          locale: input.locale,
          country: input.country,
          fiscalYearStartMonth: input.fiscalYearStartMonth,
          createdAt: new Date().toISOString(),
        };
        state.organizations.push(org);
        const existing = state.users.find((u) => u.email === input.owner.email);
        let owner;
        if (existing) {
          state.memberships.push({ userId: existing.id, organizationId: org.id, role: 'owner' });
          recount();
          owner = { status: 'added' as const, userId: existing.id };
        } else {
          const token = `demo-${crypto.randomUUID()}`; // as long as a real token, so the accept page treats it the same
          const expiresAt = new Date(Date.now() + 7 * DAY).toISOString();
          state.invitations.push({ token, organizationId: org.id, email: input.owner.email, expiresAt });
          owner = { status: 'invited' as const, email: input.owner.email, inviteUrl: inviteUrl(token), expiresAt };
        }
        log('platform.organization.create', 'organization', org.id, { id: org.id, name: org.name });
        save();
        return { organization: org, owner };
      }),

    updateOrganization: (orgId, raw) =>
      wait(() => {
        const parsed = organizationUpdateSchema.safeParse(raw);
        if (!parsed.success) fail('validation', 400, 'Some fields are not valid.');
        const o = findOrg(orgId);
        Object.assign(o, parsed.data);
        log('platform.organization.update', 'organization', o.id, { id: o.id, name: o.name });
        save();
        return o;
      }),

    setOrganizationStatus: (orgId, action) =>
      wait(() => {
        const o = findOrg(orgId);
        const next: Status = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
        if (o.status === next) fail('conflict', 409, 'Nothing to change.');
        o.status = next;
        log(`platform.organization.${action}`, 'organization', o.id, { id: o.id, name: o.name });
        save();
        return o;
      }),

    listUsers: (q) =>
      wait(() => {
        recount();
        const rows = [...state.users]
          .filter((u) => (!q.status || u.status === q.status) && (q.superAdmin === undefined || u.isSuperAdmin === q.superAdmin) && (matches(u.name, q.search) || matches(u.email, q.search)))
          .sort((a, b) => Number(b.isSuperAdmin) - Number(a.isSuperAdmin) || b.createdAt.localeCompare(a.createdAt));
        return page(rows, q.page, q.pageSize);
      }),

    userAction: (userId, action: UserAction) =>
      wait(() => {
        const u = findUser(userId);
        const otherActiveSuperAdmins = state.users.filter((x) => x.id !== u.id && x.isSuperAdmin && x.status === 'ACTIVE').length;
        const isLast = u.isSuperAdmin && u.status === 'ACTIVE' && otherActiveSuperAdmins === 0;
        if (action === 'promote') {
          if (u.isSuperAdmin) fail('conflict', 409, 'Already a Super Admin.');
          if (u.status !== 'ACTIVE') fail('validation', 400, 'Reactivate this account first.', { reason: 'inactive' });
          u.isSuperAdmin = true;
        } else if (action === 'demote') {
          if (!u.isSuperAdmin) fail('conflict', 409, 'Not a Super Admin.');
          if (isLast) fail('conflict', 409, 'LedgerNest needs at least one active Super Admin.', { reason: 'last_super_admin' });
          u.isSuperAdmin = false;
        } else if (action === 'suspend') {
          if (u.id === DEMO_ACTOR.id) fail('validation', 400, "You can't suspend your own account.", { reason: 'self' });
          if (isLast) fail('conflict', 409, 'LedgerNest needs at least one active Super Admin.', { reason: 'last_super_admin' });
          u.status = 'SUSPENDED';
        } else {
          u.status = 'ACTIVE';
        }
        log(`platform.user.${action}`, 'user', u.id, null);
        save();
        return u;
      }),

    previewInvitation: (token) =>
      wait((): InvitationPreview => {
        const inv = state.invitations.find((i) => i.token === token) ?? fail('not_found', 404, 'This invitation link is not valid.');
        if (inv.acceptedAt) fail('gone', 410, 'This invitation has already been used.');
        if (Date.parse(inv.expiresAt) <= Date.now()) fail('gone', 410, 'This invitation has expired.');
        const org = findOrg(inv.organizationId);
        return { organizationName: org.name, email: inv.email, role: { type: 'built_in', key: 'owner' }, accountExists: state.users.some((u) => u.email === inv.email), expiresAt: inv.expiresAt };
      }),

    acceptInvitationSignedIn: (token) =>
      wait(() => {
        const inv = state.invitations.find((i) => i.token === token && !i.acceptedAt) ?? fail('gone', 410, 'This invitation has already been used.');
        inv.acceptedAt = new Date().toISOString();
        const org = findOrg(inv.organizationId);
        save();
        return { organizationId: org.id, organizationName: org.name };
      }),
  };
}

/** Demo mode: a brand-new person accepting creates their account in the sample data. */
export function demoAcceptAsNewUser(token: string, name: string) {
  const state = load();
  const inv = state.invitations.find((i) => i.token === token && !i.acceptedAt);
  if (!inv) throw new ApiError('gone', 410, 'This invitation has already been used.');
  inv.acceptedAt = new Date().toISOString();
  const userId = id('u');
  state.users.push({ id: userId, name, email: inv.email, status: 'ACTIVE', isSuperAdmin: false, lastLoginAt: new Date().toISOString(), createdAt: new Date().toISOString(), organizationCount: 1 });
  state.memberships.push({ userId, organizationId: inv.organizationId, role: 'owner' });
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  return inv.email;
}

/** Wipes the demo data back to the sample set. */
export function resetDemoPlatform() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
