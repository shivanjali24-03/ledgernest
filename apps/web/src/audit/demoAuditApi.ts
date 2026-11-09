import { AUDIT_ACTION_GROUPS, AUDIT_EXPORT_LIMIT, csvCell } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { AuditActor, AuditApi, AuditEntry, AuditFilters, AuditScope } from './types';

/**
 * The audit log in demo mode: a realistic, read-only history for the sample company
 * and the platform, shaped exactly like the API's entries (same actions, same before/after).
 * Exports are added to the history, just as the real log records them.
 */

const HOUR = 3_600_000;
const DEMO_ORG = { id: 'o-1', name: 'Nest Demo Pvt. Ltd.' };
const ORGS = {
  ganesh: { id: 'o-2', name: 'Shree Ganesh Traders' },
  bluewave: { id: 'o-3', name: 'Bluewave Clinics' },
  lumiere: { id: 'o-5', name: 'Café Lumière' },
  alnoor: { id: 'o-6', name: 'Al Noor Trading LLC' },
  greenroots: { id: 'o-7', name: 'GreenRoots Foundation' },
};

const person = (id: string, name: string, email: string) => ({
  id,
  name,
  email,
});
const P = {
  shivanjali: person('u-demo', 'Shivanjali Desai', 'admin@ledgernest.demo'),
  rohanAdmin: person('u-m-2', 'Rohan Mehta', 'rohan@nestdemo.in'),
  priya: person('u-m-3', 'Priya Nair', 'priya@nestdemo.in'),
  fatima: person('u-m-5', 'Fatima Sheikh', 'fatima@auditpartners.in'),
  neha: person('u-m-7', 'Neha Gupta', 'neha@nestdemo.in'),
  support: person('u-2', 'Kiran Bose', 'kiran@ledgernest.demo'),
  asha: person('u-3', 'Asha Rao', 'asha@shreeganesh.in'),
  omar: person('u-7', 'Omar Haddad', 'omar@alnoor.ae'),
  meera: person('u-8', 'Meera Joshi', 'meera@greenroots.org'),
};
/** Someone whose account was later deleted: only the email captured at the time remains */
const LEAVER: AuditActor = { id: null, name: null, email: 'arjun@nestdemo.in' };

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

interface Seed {
  hoursAgo: number;
  action: string;
  actor: AuditActor | null;
  org?: { id: string; name: string } | null;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  ua?: string;
}

const SEEDS: Seed[] = [
  {
    hoursAgo: 0.2,
    action: 'auth.login.success',
    actor: P.shivanjali,
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 1.5,
    action: 'org.role.update',
    actor: P.shivanjali,
    org: DEMO_ORG,
    entityType: 'role',
    entityId: 'r-cashier',
    before: {
      name: 'Branch cashier',
      description: 'Records receipts and payments at the branch.',
      permissions: ['banking.view', 'banking.manage', 'payments.manage', 'contacts.view'],
    },
    after: {
      name: 'Branch cashier',
      description: 'Records receipts and payments at the branch.',
      permissions: ['banking.view', 'banking.manage', 'payments.manage', 'contacts.view', 'invoices.view'],
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 3,
    action: 'platform.support_access',
    actor: P.support,
    org: DEMO_ORG,
    entityType: 'organization',
    entityId: DEMO_ORG.id,
    after: {
      method: 'GET',
      path: '/api/v1/organization/members',
      permissions: ['users.view'],
    },
    ip: '103.21.58.4',
    ua: BROWSER,
  },
  {
    hoursAgo: 6,
    action: 'auth.login.failed',
    actor: P.omar,
    after: { failures: 3 },
    ip: '94.200.17.66',
    ua: PHONE,
  },
  {
    hoursAgo: 20,
    action: 'org.member.role_change',
    actor: P.rohanAdmin,
    org: DEMO_ORG,
    entityType: 'membership',
    entityId: 'm-3',
    before: {
      user: 'priya@nestdemo.in',
      builtInRole: 'bookkeeper',
      customRoleId: null,
    },
    after: {
      user: 'priya@nestdemo.in',
      builtInRole: 'accountant',
      customRoleId: null,
    },
    ip: '117.99.4.201',
    ua: BROWSER,
  },
  {
    hoursAgo: 30,
    action: 'org.audit.export',
    actor: P.fatima,
    org: DEMO_ORG,
    after: { filters: { group: 'members' }, rows: 14 },
    ip: '182.73.40.9',
    ua: BROWSER,
  },
  {
    hoursAgo: 52,
    action: 'platform.organization.create',
    actor: P.shivanjali,
    org: ORGS.greenroots,
    entityType: 'organization',
    entityId: ORGS.greenroots.id,
    after: {
      name: 'GreenRoots Foundation',
      slug: 'greenroots-foundation',
      baseCurrency: 'INR',
      locale: 'en-IN',
      country: 'IN',
      owner: { email: 'meera@greenroots.org', status: 'invited' },
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 76,
    action: 'org.invitation.create',
    actor: P.rohanAdmin,
    org: DEMO_ORG,
    entityType: 'invitation',
    entityId: 'i-1',
    after: {
      email: 'kabir@nestdemo.in',
      builtInRole: 'accountant',
      customRoleId: null,
    },
    ip: '117.99.4.201',
    ua: BROWSER,
  },
  {
    hoursAgo: 98,
    action: 'org.member.remove',
    actor: P.shivanjali,
    org: DEMO_ORG,
    entityType: 'membership',
    entityId: 'm-9',
    before: {
      user: 'arjun@nestdemo.in',
      builtInRole: 'bookkeeper',
      customRoleId: null,
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 100,
    action: 'org.role.create',
    actor: LEAVER,
    org: DEMO_ORG,
    entityType: 'role',
    entityId: 'r-tax',
    after: {
      name: 'Tax consultant',
      description: 'Prepares tax filings from the books.',
      permissions: ['accounts.view', 'journals.view', 'reports.view', 'reports.export', 'taxes.manage'],
    },
    ip: '106.51.77.30',
    ua: PHONE,
  },
  {
    hoursAgo: 150,
    action: 'platform.organization.suspend',
    actor: P.shivanjali,
    org: ORGS.alnoor,
    entityType: 'organization',
    entityId: ORGS.alnoor.id,
    before: { status: 'ACTIVE' },
    after: {
      status: 'SUSPENDED',
      reason: 'Subscription payment overdue by 60 days',
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 151,
    action: 'platform.user.suspend',
    actor: P.shivanjali,
    entityType: 'user',
    entityId: 'u-7',
    before: { isSuperAdmin: false, status: 'ACTIVE' },
    after: {
      isSuperAdmin: false,
      status: 'SUSPENDED',
      reason: 'Organisation suspended',
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 170,
    action: 'invitation.accept',
    actor: P.neha,
    org: DEMO_ORG,
    entityType: 'invitation',
    entityId: 'i-0',
    after: { alreadyMember: false },
    ip: '27.4.199.12',
    ua: PHONE,
  },
  {
    hoursAgo: 171,
    action: 'org.invitation.revoke',
    actor: P.rohanAdmin,
    org: DEMO_ORG,
    entityType: 'invitation',
    entityId: 'i-x',
    before: { email: 'old.vendor@agency.in' },
    ip: '117.99.4.201',
    ua: BROWSER,
  },
  {
    hoursAgo: 200,
    action: 'platform.organization.update',
    actor: P.support,
    org: ORGS.lumiere,
    entityType: 'organization',
    entityId: ORGS.lumiere.id,
    before: { name: 'Cafe Lumiere', fiscalYearStartMonth: 4 },
    after: { name: 'Café Lumière', fiscalYearStartMonth: 1 },
    ip: '103.21.58.4',
    ua: BROWSER,
  },
  {
    hoursAgo: 230,
    action: 'auth.lockout',
    actor: P.asha,
    after: { failures: 5 },
    ip: '59.88.12.140',
    ua: PHONE,
  },
  {
    hoursAgo: 260,
    action: 'platform.user.promote',
    actor: P.shivanjali,
    entityType: 'user',
    entityId: 'u-2',
    before: { isSuperAdmin: false, status: 'ACTIVE' },
    after: { isSuperAdmin: true, status: 'ACTIVE' },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 300,
    action: 'org.role.create',
    actor: P.shivanjali,
    org: ORGS.bluewave,
    entityType: 'role',
    entityId: 'r-b1',
    after: {
      name: 'Front desk',
      description: null,
      permissions: ['contacts.view', 'invoices.view'],
    },
    ip: '49.36.112.8',
    ua: BROWSER,
  },
  {
    hoursAgo: 340,
    action: 'org.invitation.create',
    actor: P.asha,
    org: ORGS.ganesh,
    entityType: 'invitation',
    entityId: 'i-g1',
    after: {
      email: 'ca.patil@firm.in',
      builtInRole: 'auditor',
      customRoleId: null,
    },
    ip: '59.88.12.140',
    ua: BROWSER,
  },
  {
    hoursAgo: 400,
    action: 'org.role.delete',
    actor: P.priya,
    org: DEMO_ORG,
    entityType: 'role',
    entityId: 'r-old',
    before: { name: 'Seasonal staff', permissions: ['invoices.view'] },
    ip: '157.32.8.77',
    ua: BROWSER,
  },
  {
    hoursAgo: 500,
    action: 'auth.login.success',
    actor: P.meera,
    ip: '122.170.3.19',
    ua: PHONE,
  },
];

type Stored = AuditEntry & { orgId: string | null };

let history: Stored[] | null = null;
function entries(): Stored[] {
  history ??= SEEDS.map((s, i) => ({
    id: `demo-audit-${String(SEEDS.length - i).padStart(4, '0')}`,
    action: s.action,
    createdAt: new Date(Date.now() - s.hoursAgo * HOUR).toISOString(),
    actor: s.actor,
    organization: s.org ?? null,
    orgId: s.org?.id ?? null,
    entityType: s.entityType ?? null,
    entityId: s.entityId ?? null,
    before: s.before ?? null,
    after: s.after ?? null,
    ip: s.ip ?? null,
    userAgent: s.ua ?? null,
  }));
  return history;
}

/** Test helper: start again from the seeded history. */
export const resetDemoAudit = () => {
  history = null;
};

const PAGE = 8; // small, so "Load more" is visible in the demo

export function createDemoAuditApi(scope: AuditScope, canView: () => boolean): AuditApi {
  const visible = (f: AuditFilters) => {
    if (!canView())
      throw new ApiError('forbidden', 403, undefined, undefined, {
        missing: [scope === 'platform' ? 'platform.audit.view' : 'audit.view'],
      });
    const org = scope === 'organization' ? DEMO_ORG.id : f.organizationId;
    const prefixes = f.group ? AUDIT_ACTION_GROUPS[f.group] : null;
    return entries().filter(
      (e) =>
        (!org || e.orgId === org) &&
        (!prefixes || prefixes.some((p) => e.action.startsWith(p))) &&
        (!f.actorId || e.actor?.id === f.actorId) &&
        (!f.from || e.createdAt >= new Date(f.from).toISOString()) &&
        (!f.to || e.createdAt <= new Date(f.to).toISOString()),
    );
  };
  const view = ({ orgId: _orgId, ...e }: Stored): AuditEntry => {
    if (scope === 'platform') return e;
    const { organization: _org, ...rest } = e;
    return rest;
  };
  const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => fn())().then(resolve, reject), 250));

  return {
    list: (f, cursor) =>
      wait(() => {
        const all = visible(f);
        const start = cursor ? all.findIndex((e) => e.id === cursor) + 1 : 0;
        const items = all.slice(start, start + PAGE);
        return {
          items: items.map(view),
          nextCursor: start + PAGE < all.length ? items[items.length - 1]!.id : null,
        };
      }),
    actors: () =>
      wait(() => {
        const seen = new Map<string, { id: string; name: string; email: string }>();
        for (const e of visible({}))
          if (e.actor?.id && e.actor.name && !seen.has(e.actor.id))
            seen.set(e.actor.id, {
              id: e.actor.id,
              name: e.actor.name,
              email: e.actor.email,
            });
        return [...seen.values()];
      }),
    exportCsv: (f) =>
      wait(() => {
        const rows = visible(f).slice(0, AUDIT_EXPORT_LIMIT);
        const platform = scope === 'platform';
        const header = ['time', 'action', 'actor', ...(platform ? ['organization'] : []), 'entity_type', 'entity_id', 'ip', 'before', 'after'];
        const lines = rows.map((r) =>
          [r.createdAt, r.action, r.actor?.email, ...(platform ? [r.organization?.name ?? ''] : []), r.entityType, r.entityId, r.ip, r.before, r.after].map(csvCell).join(','),
        );
        const body = `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
        // Exports are themselves part of the history
        entries().unshift({
          id: `demo-audit-x${Date.now()}`,
          action: platform ? 'platform.audit.export' : 'org.audit.export',
          createdAt: new Date().toISOString(),
          actor: P.shivanjali,
          organization: platform ? null : DEMO_ORG,
          orgId: platform ? (f.organizationId ?? null) : DEMO_ORG.id,
          entityType: null,
          entityId: null,
          before: null,
          after: { filters: f, rows: rows.length },
          ip: '49.36.112.8',
          userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        });
        const day = new Date().toISOString().slice(0, 10);
        return {
          blob: new Blob([body], { type: 'text/csv;charset=utf-8' }),
          filename: `${platform ? 'platform-' : ''}audit-log-${day}.csv`,
          truncated: false,
        };
      }),
  };
}
