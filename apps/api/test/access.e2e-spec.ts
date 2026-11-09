import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { BUILT_IN_ROLES } from '@ledgernest/shared';
import { runInOrganization } from '../src/access/tenant-context.js';
import { TenantPrisma } from '../src/access/tenant-prisma.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/**
 * Two companies, A and B, plus a suspended one. Proves that nobody can see or touch
 * another organisation's data, and that roles are enforced on every endpoint.
 */
describe('Authorisation and organisation isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; email: string; token: string }> = {};
  const orgs: Record<'A' | 'B' | 'S', string> = { A: '', B: '', S: '' };
  let roleA = '';
  let roleB = '';

  const http = () => request(app.getHttpServer());
  const get = (path: string, who: string, org?: string) => {
    const r = http().get(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`);
    return org ? r.set('X-Organization-Id', org) : r;
  };

  async function makeUser(key: string, isSuperAdmin = false) {
    const email = `${key}-${run}@test.ledgernest.local`;
    const u = await prisma.user.create({ data: { email, name: key, passwordHash: 'not-used-here', isSuperAdmin } });
    users[key] = { id: u.id, email, token: await jwt.signAsync({ sub: u.id, sa: isSuperAdmin }, { expiresIn: '15m' }) };
    return u.id;
  }
  const join = (user: string, org: string, builtInRole: string | null, customRoleId?: string) =>
    prisma.membership.create({ data: { userId: users[user]!.id, organizationId: org, builtInRole, customRoleId } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    for (const k of ['A', 'B', 'S'] as const) {
      orgs[k] = (await prisma.organization.create({ data: { name: `Org ${k} ${run}`, slug: `org-${k.toLowerCase()}-${run}`, status: k === 'S' ? 'SUSPENDED' : 'ACTIVE' } })).id;
    }
    // A custom role that also (wrongly) stores a platform permission: it must not grant it
    roleA = (await prisma.role.create({ data: { organizationId: orgs.A, name: 'Team lead', permissions: ['users.view', 'platform.organizations.view'] } })).id;
    roleB = (await prisma.role.create({ data: { organizationId: orgs.B, name: 'Clerk', permissions: ['accounts.view'] } })).id;

    for (const k of ['ownerA', 'viewerA', 'customA', 'ownerB', 'memberS']) await makeUser(k);
    await makeUser('super', true);
    await join('ownerA', orgs.A, 'owner');
    await join('viewerA', orgs.A, 'viewer');
    await join('customA', orgs.A, null, roleA);
    await join('ownerB', orgs.B, 'owner');
    await join('memberS', orgs.S, 'owner');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.organization.deleteMany({ where: { id: { in: Object.values(orgs) } } });
    await app.close();
  });

  describe('locked by default', () => {
    it('organisation endpoints need a signed-in user', async () => {
      await http().get('/api/v1/organization').set('X-Organization-Id', orgs.A).expect(401);
    });

    it('public endpoints stay public', async () => {
      await http().get('/api/v1/health').expect(200);
      await http().post('/api/v1/auth/login').send({}).expect(400); // validation, not 401
    });

    it('/auth/me still works with a token', async () => {
      const res = await get('/auth/me', 'ownerA').expect(200);
      expect(res.body.user.email).toBe(users.ownerA!.email);
    });
  });

  describe('choosing an organisation', () => {
    it('requires the X-Organization-Id header', async () => {
      const res = await get('/organization', 'ownerA').expect(400);
      expect(res.body.message).toMatch(/X-Organization-Id/);
      await get('/organization', 'ownerA', 'not-a-uuid').expect(400);
    });

    it('a member gets their organisation and role', async () => {
      const res = await get('/organization', 'ownerA', orgs.A).expect(200);
      expect(res.body.organization.id).toBe(orgs.A);
      expect(res.body.access).toMatchObject({ role: { type: 'built_in', key: 'owner' }, supportAccess: false });
    });

    it("another company's organisation looks exactly like one that doesn't exist", async () => {
      const other = await get('/organization', 'ownerA', orgs.B).expect(404);
      const missing = await get('/organization', 'ownerA', randomUUID()).expect(404);
      expect(other.body.message).toBe(missing.body.message);
    });
  });

  describe('data isolation', () => {
    it('members lists only ever contain the chosen organisation', async () => {
      const a = await get('/organization/members', 'ownerA', orgs.A).expect(200);
      expect(a.body.map((m: { user: { email: string } }) => m.user.email).sort()).toEqual(
        [users.ownerA!.email, users.viewerA!.email, users.customA!.email].sort(),
      );
      const b = await get('/organization/members', 'ownerB', orgs.B).expect(200);
      expect(b.body.map((m: { user: { email: string } }) => m.user.email)).toEqual([users.ownerB!.email]);
    });

    it('scoped queries cannot reach another organisation, even by id', async () => {
      const db = app.get(TenantPrisma).db;
      await runInOrganization(orgs.A, async () => {
        expect((await db.role.findMany()).map((r) => r.id)).toEqual([roleA]);
        expect(await db.role.findUnique({ where: { id: roleB } })).toBeNull();
        expect(await db.role.findMany({ where: { organizationId: orgs.B } })).toHaveLength(1); // forced back to A
        const updated = await db.role.updateMany({ where: { id: roleB }, data: { name: 'hacked' } });
        expect(updated.count).toBe(0);
      });
      expect((await prisma.role.findUniqueOrThrow({ where: { id: roleB } })).name).toBe('Clerk');
    });

    it('rows created through the scoped client always land in the current organisation', async () => {
      const db = app.get(TenantPrisma).db;
      const created = await runInOrganization(orgs.A, () => db.role.create({ data: { name: `Sneaky ${run}`, organizationId: orgs.B, permissions: [] } }));
      expect(created.organizationId).toBe(orgs.A);
    });

    it('scoped queries refuse to run without an organisation', async () => {
      await expect(app.get(TenantPrisma).db.role.findMany()).rejects.toThrow(/No organisation in context/);
    });
  });

  describe('roles', () => {
    it('blocks what the role does not allow and says which permission is missing', async () => {
      const res = await get('/organization/members', 'viewerA', orgs.A).expect(403);
      expect(res.body.details).toEqual({ missing: ['users.view'] });
      expect(BUILT_IN_ROLES.viewer.permissions).not.toContain('users.view');
    });

    it('custom roles grant exactly their permissions', async () => {
      await get('/organization/members', 'customA', orgs.A).expect(200);
      await get('/organization', 'customA', orgs.A).expect(403); // org.settings.view not in the role
    });

    it('a platform permission stored on a custom role grants nothing', async () => {
      await get('/platform/organizations', 'customA').expect(403);
    });
  });

  describe('Super Admin', () => {
    it('only Super Admins see platform endpoints', async () => {
      await get('/platform/organizations', 'ownerA').expect(403);
      const res = await get('/platform/organizations?pageSize=100', 'super').expect(200);
      const ids = res.body.items.map((o: { id: string }) => o.id);
      expect(ids).toEqual(expect.arrayContaining([orgs.A, orgs.B]));
      expect(res.body.items.find((o: { id: string }) => o.id === orgs.A).memberCount).toBe(3);
    });

    it('can open any organisation for support, and every access is audited', async () => {
      const res = await get('/organization', 'super', orgs.B).expect(200);
      expect(res.body.access).toMatchObject({ role: { type: 'support' }, supportAccess: true });

      const audit = await prisma.auditLog.findMany({ where: { actorId: users.super!.id, action: 'platform.support_access', organizationId: orgs.B } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.after).toMatchObject({ method: 'GET', path: '/api/v1/organization' });
    });

    it('members of an organisation are not audited as support access', async () => {
      await get('/organization', 'ownerA', orgs.A).expect(200);
      expect(await prisma.auditLog.count({ where: { actorId: users.ownerA!.id, action: 'platform.support_access' } })).toBe(0);
    });

    it('losing Super Admin takes effect immediately, even with a token that still says otherwise', async () => {
      await makeUser('exSuper', true);
      await get('/platform/organizations', 'exSuper').expect(200);
      await prisma.user.update({ where: { id: users.exSuper!.id }, data: { isSuperAdmin: false } });
      await get('/platform/organizations', 'exSuper').expect(403);
    });
  });

  describe('suspensions', () => {
    it('a suspended user is shut out immediately, even with an unexpired token', async () => {
      await makeUser('soonSuspended');
      await join('soonSuspended', orgs.A, 'viewer');
      await get('/organization', 'soonSuspended', orgs.A).expect(200);
      await prisma.user.update({ where: { id: users.soonSuspended!.id }, data: { status: 'SUSPENDED' } });
      await get('/organization', 'soonSuspended', orgs.A).expect(401);
    });

    it("members of a suspended organisation can't use it; a Super Admin still can", async () => {
      const res = await get('/organization', 'memberS', orgs.S).expect(403);
      expect(res.body.message).toMatch(/suspended/);
      await get('/organization', 'super', orgs.S).expect(200);
    });
  });
});
