import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/**
 * An organisation's own team management. The rule under test everywhere:
 * nobody can grant more access than they have.
 */
describe('Team: members, invitations and custom roles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; email: string; token: string }> = {};
  const memberships: Record<string, string> = {};
  let orgA = '';
  let orgB = '';
  let roleB = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1/organization${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1/organization${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1/organization${p}`)).send(body),
      del: (p: string) => auth(http().delete(`/api/v1/organization${p}`)),
    };
  };
  const email = (k: string) => `${k.toLowerCase()}-${run}@test.ledgernest.local`;
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  async function makeUser(key: string, isSuperAdmin = false) {
    const u = await prisma.user.create({ data: { email: email(key), name: `User ${key}`, passwordHash: 'unused', isSuperAdmin } });
    users[key] = { id: u.id, email: u.email, token: await jwt.signAsync({ sub: u.id, sa: isSuperAdmin }, { expiresIn: '15m' }) };
  }
  async function join(key: string, org: string, builtInRole: string | null, customRoleId?: string) {
    const m = await prisma.membership.create({ data: { userId: users[key]!.id, organizationId: org, builtInRole, customRoleId } });
    memberships[key] = m.id;
  }
  const roleOf = async (key: string) => prisma.membership.findUniqueOrThrow({ where: { id: memberships[key]! } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    orgA = (await prisma.organization.create({ data: { name: `Team A ${run}`, slug: `team-a-${run}` } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Team B ${run}`, slug: `team-b-${run}` } })).id;
    roleB = (await prisma.role.create({ data: { organizationId: orgB, name: 'B only', permissions: ['accounts.view'] } })).id;

    for (const k of ['owner', 'admin', 'accountant', 'viewer', 'lead', 'ownerB']) await makeUser(k);
    await makeUser('super', true);
    const leadRole = await prisma.role.create({
      data: { organizationId: orgA, name: 'Team lead', permissions: ['users.view', 'users.manage', 'users.invite', 'org.settings.view', 'accounts.view', 'reports.view'] },
    });
    await join('owner', orgA, 'owner');
    await join('admin', orgA, 'admin');
    await join('accountant', orgA, 'accountant');
    await join('viewer', orgA, 'viewer');
    await join('lead', orgA, null, leadRole.id);
    await join('ownerB', orgB, 'owner');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  describe('members', () => {
    it('lists members with their roles; a Viewer cannot', async () => {
      const res = await as('admin').get('/members').expect(200);
      expect(res.body).toHaveLength(5);
      expect(res.body.find((m: { user: { email: string } }) => m.user.email === email('lead')).role).toMatchObject({ type: 'custom', name: 'Team lead' });
      await as('viewer').get('/members').expect(403);
    });

    it('an Admin changes a role below their own, and it is audited', async () => {
      await as('admin').patch(`/members/${memberships.accountant}`, { role: { builtInRole: 'bookkeeper' } }).expect(200);
      expect((await roleOf('accountant')).builtInRole).toBe('bookkeeper');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'org.member.role_change', entityId: memberships.accountant } });
      expect(audit.before).toMatchObject({ builtInRole: 'accountant' });
      expect(audit.after).toMatchObject({ builtInRole: 'bookkeeper' });
      await as('admin').patch(`/members/${memberships.accountant}`, { role: { builtInRole: 'accountant' } }).expect(200);
    });

    it('an Admin cannot hand out Admin or Owner, or touch an Owner', async () => {
      const toOwner = await as('admin').patch(`/members/${memberships.viewer}`, { role: { builtInRole: 'owner' } }).expect(403);
      expect(toOwner.body.details.reason).toBe('exceeds_your_access');
      await as('admin').patch(`/members/${memberships.viewer}`, { role: { builtInRole: 'admin' } }).expect(403);
      await as('admin').patch(`/members/${memberships.owner}`, { role: { builtInRole: 'viewer' } }).expect(403);
      await as('admin').del(`/members/${memberships.owner}`).expect(403);
    });

    it('a custom-role team lead can only give roles within their own access', async () => {
      await as('lead').patch(`/members/${memberships.accountant}`, { role: { builtInRole: 'viewer' } }).expect(403); // can't manage an accountant
      const res = await as('lead').patch(`/members/${memberships.viewer}`, { role: { builtInRole: 'bookkeeper' } }).expect(403);
      expect(res.body.details.missing).toEqual(expect.arrayContaining(['journals.create']));
    });

    it('nobody changes or removes themselves', async () => {
      const res = await as('owner').patch(`/members/${memberships.owner}`, { role: { builtInRole: 'viewer' } }).expect(400);
      expect(res.body.details.reason).toBe('self');
      await as('admin').del(`/members/${memberships.admin}`).expect(400);
    });

    it('an organisation always keeps an Owner', async () => {
      const res = await as('super').patch(`/members/${memberships.owner}`, { role: { builtInRole: 'admin' } }).expect(409);
      expect(res.body.details.reason).toBe('last_owner');
      await as('super').del(`/members/${memberships.owner}`).expect(409);

      // With a second Owner, the first can step down
      await as('owner').patch(`/members/${memberships.accountant}`, { role: { builtInRole: 'owner' } }).expect(200);
      await as('accountant').patch(`/members/${memberships.owner}`, { role: { builtInRole: 'admin' } }).expect(200);
      await as('super').patch(`/members/${memberships.owner}`, { role: { builtInRole: 'owner' } }).expect(200);
      await as('owner').patch(`/members/${memberships.accountant}`, { role: { builtInRole: 'accountant' } }).expect(200);
    });

    it("cannot reach another organisation's members or roles", async () => {
      await as('admin').patch(`/members/${memberships.ownerB}`, { role: { builtInRole: 'viewer' } }).expect(404);
      await as('admin').patch(`/members/${memberships.viewer}`, { role: { customRoleId: roleB } }).expect(404);
    });

    it('removes a member', async () => {
      await makeUser('leaver');
      await join('leaver', orgA, 'viewer');
      await as('admin').del(`/members/${memberships.leaver}`).expect(204);
      expect(await prisma.membership.count({ where: { id: memberships.leaver } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'org.member.remove', entityId: memberships.leaver } })).toBe(1);
    });
  });

  describe('invitations', () => {
    it('invites, refuses duplicates and members, and lists pending invitations', async () => {
      const res = await as('admin').post('/invitations', { email: email('newbie'), role: { builtInRole: 'accountant' } }).expect(201);
      expect(res.body).toMatchObject({ email: email('newbie'), accountExists: false });
      expect(res.body.inviteUrl).toMatch(/accept-invite\?token=/);

      const dup = await as('admin').post('/invitations', { email: email('newbie'), role: { builtInRole: 'viewer' } }).expect(409);
      expect(dup.body.details.reason).toBe('already_invited');
      const member = await as('admin').post('/invitations', { email: email('viewer'), role: { builtInRole: 'viewer' } }).expect(409);
      expect(member.body.details.reason).toBe('already_member');

      const list = await as('admin').get('/invitations').expect(200);
      expect(list.body).toEqual([expect.objectContaining({ email: email('newbie'), role: { type: 'built_in', key: 'accountant' }, expired: false })]);
    });

    it('an Admin cannot invite an Owner', async () => {
      const res = await as('admin').post('/invitations', { email: email('wannabe'), role: { builtInRole: 'owner' } }).expect(403);
      expect(res.body.details.reason).toBe('exceeds_your_access');
    });

    it('resending issues a new link and kills the old one', async () => {
      const first = await as('admin').post('/invitations', { email: email('resend'), role: { builtInRole: 'viewer' } }).expect(201);
      const second = await as('admin').post(`/invitations/${first.body.id}/resend`).expect(200);
      expect(second.body.inviteUrl).not.toBe(first.body.inviteUrl);
      await http().post('/api/v1/invitations/preview').send({ token: tokenOf(first.body.inviteUrl) }).expect(404);
      await http().post('/api/v1/invitations/preview').send({ token: tokenOf(second.body.inviteUrl) }).expect(200);
    });

    it('revoking makes the link useless', async () => {
      const inv = await as('admin').post('/invitations', { email: email('revoked'), role: { builtInRole: 'viewer' } }).expect(201);
      await as('admin').del(`/invitations/${inv.body.id}`).expect(204);
      await http().post('/api/v1/invitations/preview').send({ token: tokenOf(inv.body.inviteUrl) }).expect(404);
      expect((await as('admin').get('/invitations')).body.map((i: { email: string }) => i.email)).not.toContain(email('revoked'));
    });

    it('accepting an invitation for a custom role gives that role', async () => {
      const role = await as('owner').post('/roles', { name: `Cashier ${run}`, permissions: ['banking.view', 'banking.manage'] }).expect(201);
      const inv = await as('admin').post('/invitations', { email: email('cashier'), role: { customRoleId: role.body.id } }).expect(201);
      const accepted = await http().post('/api/v1/invitations/accept').send({ token: tokenOf(inv.body.inviteUrl), name: 'Cash Ier', password: 'Cashier-Pass-123' }).expect(200);
      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accepted.body.accessToken}`).expect(200);
      expect(me.body.organizations[0]).toMatchObject({ id: orgA, role: { type: 'custom', name: `Cashier ${run}` }, permissions: ['banking.view', 'banking.manage'] });
    });
  });

  describe('custom roles', () => {
    it('lists built-in roles read-only, with what you may assign', async () => {
      const res = await as('admin').get('/roles').expect(200);
      const flags = Object.fromEntries(res.body.builtIn.map((r: { key: string; canAssign: boolean }) => [r.key, r.canAssign]));
      expect(flags).toMatchObject({ owner: false, admin: false, accountant: true, viewer: true });
      expect(res.body.custom.find((r: { name: string }) => r.name === 'Team lead')).toMatchObject({ memberCount: 1 });
    });

    it('you can only build a role from access you have yourself', async () => {
      await as('admin').post('/roles', { name: `Reviewer ${run}`, permissions: ['reports.view', 'journals.view'] }).expect(201);
      const res = await as('admin').post('/roles', { name: `Closer ${run}`, permissions: ['reports.view', 'org.billing.manage'] }).expect(403);
      expect(res.body.details).toEqual({ reason: 'exceeds_your_access', missing: ['org.billing.manage'] });
      const dup = await as('admin').post('/roles', { name: `Reviewer ${run}`, permissions: ['reports.view'] }).expect(409);
      expect(dup.body.details.reason).toBe('name_taken');
      await as('accountant').post('/roles', { name: 'Nope', permissions: ['reports.view'] }).expect(403);
    });

    it('editing a role changes what its members can do immediately', async () => {
      const role = await as('admin').post('/roles', { name: `Peeker ${run}`, permissions: ['reports.view'] }).expect(201);
      await makeUser('peeker');
      await join('peeker', orgA, null, role.body.id);
      await as('peeker').get('/members').expect(403);
      await as('admin').patch(`/roles/${role.body.id}`, { permissions: ['reports.view', 'users.view'] }).expect(200);
      await as('peeker').get('/members').expect(200);
    });

    it("can't delete a role people still have", async () => {
      const role = await as('admin').post('/roles', { name: `Temp ${run}`, permissions: ['reports.view'] }).expect(201);
      await makeUser('temp');
      await join('temp', orgA, null, role.body.id);
      const res = await as('admin').del(`/roles/${role.body.id}`).expect(409);
      expect(res.body.details).toEqual({ reason: 'in_use', memberCount: 1 });
      await as('admin').patch(`/members/${memberships.temp}`, { role: { builtInRole: 'viewer' } }).expect(200);
      await as('admin').del(`/roles/${role.body.id}`).expect(204);
    });

    it("can't edit or delete another organisation's role", async () => {
      await as('admin').patch(`/roles/${roleB}`, { name: 'Hijacked' }).expect(404);
      await as('admin').del(`/roles/${roleB}`).expect(404);
    });
  });
});
