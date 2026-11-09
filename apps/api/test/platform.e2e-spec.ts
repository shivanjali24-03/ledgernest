import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashToken } from '../src/auth/tokens.js';
import { InvitationsService } from '../src/invitations/invitations.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Super Admin console and invitations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; email: string; token: string }> = {};
  const orgIds: string[] = [];
  const extraEmails: string[] = [];
  /** Super Admins that existed before this file ran: parked while we test "last Super Admin" rules */
  let parked: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (p: string) => http().get(`/api/v1${p}`).set('Authorization', `Bearer ${users[who]!.token}`),
    post: (p: string, body: object = {}) => http().post(`/api/v1${p}`).set('Authorization', `Bearer ${users[who]!.token}`).send(body),
    patch: (p: string, body: object) => http().patch(`/api/v1${p}`).set('Authorization', `Bearer ${users[who]!.token}`).send(body),
  });
  const email = (k: string) => `${k.toLowerCase()}-${run}@test.ledgernest.local`;

  async function makeUser(key: string, isSuperAdmin = false) {
    const u = await prisma.user.create({ data: { email: email(key), name: `User ${key}`, passwordHash: 'unused', isSuperAdmin } });
    users[key] = { id: u.id, email: u.email, token: await jwt.signAsync({ sub: u.id, sa: isSuperAdmin }, { expiresIn: '15m' }) };
  }

  async function createOrg(body: object, who = 'super') {
    const res = await as(who).post('/platform/organizations', body);
    if (res.body?.organization?.id) orgIds.push(res.body.organization.id);
    return res;
  }

  /** The raw token from an invite URL */
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await makeUser('super', true);
    await makeUser('super2', true);
    await makeUser('regular');
    await makeUser('existingOwner');
  });

  afterAll(async () => {
    if (parked.length) await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isSuperAdmin: true } });
    // Organisations first: their invitations point at the users who sent them
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: Object.values(users).map((u) => u.id) } }, { email: { in: extraEmails } }] } });
    await app.close();
  });

  describe('organisations', () => {
    it('only Super Admins can create organisations', async () => {
      await createOrg({ name: 'Nope', owner: { email: email('x') } }, 'regular').then((r) => expect(r.status).toBe(403));
    });

    it('creates an organisation and adds an existing user as Owner straight away', async () => {
      const res = await createOrg({ name: `Acme ${run}`, baseCurrency: 'usd', country: 'us', owner: { email: users.existingOwner!.email.toUpperCase() } });
      expect(res.status).toBe(201);
      expect(res.body.organization).toMatchObject({ name: `Acme ${run}`, slug: `acme-${run}`, baseCurrency: 'USD', country: 'US', timeZone: 'America/New_York', status: 'ACTIVE' });
      expect(res.body.owner).toEqual({ status: 'added', userId: users.existingOwner!.id });
      // It starts with the system accounts LedgerNest relies on
      const system = await prisma.account.findMany({ where: { organizationId: res.body.organization.id }, select: { systemKey: true }, orderBy: { code: 'asc' } });
      expect(system.map((a) => a.systemKey)).toEqual(['retained_earnings', 'opening_balance_equity']);

      const m = await prisma.membership.findFirstOrThrow({ where: { organizationId: res.body.organization.id } });
      expect(m).toMatchObject({ userId: users.existingOwner!.id, builtInRole: 'owner' });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'platform.organization.create', entityId: res.body.organization.id } });
      expect(audit.actorId).toBe(users.super!.id);
    });

    it('invites a new Owner with a one-time link (only its hash is stored)', async () => {
      const ownerEmail = email('newowner');
      const res = await createOrg({ name: `Fresh ${run}`, owner: { email: ownerEmail } });
      expect(res.body.owner).toMatchObject({ status: 'invited', email: ownerEmail });
      expect(res.body.owner.inviteUrl).toMatch(/^http:\/\/localhost:5173\/accept-invite\?token=/);

      const inv = await prisma.invitation.findFirstOrThrow({ where: { organizationId: res.body.organization.id } });
      expect(inv.tokenHash).toBe(hashToken(tokenOf(res.body.owner.inviteUrl)));
      expect(inv.builtInRole).toBe('owner');
    });

    it('picks a free web address automatically, but refuses a taken one you chose', async () => {
      const a = await createOrg({ name: `Twin ${run}`, owner: { email: email('t1') } });
      const b = await createOrg({ name: `Twin ${run}`, owner: { email: email('t2') } });
      expect(b.body.organization.slug).toBe(`${a.body.organization.slug}-2`);
      const taken = await createOrg({ name: 'Other', slug: a.body.organization.slug, owner: { email: email('t3') } });
      expect(taken.status).toBe(409);
      expect(taken.body.details).toEqual({ field: 'slug' });
    });

    it('validates input with the shared rules', async () => {
      const res = await createOrg({ name: 'X', baseCurrency: 'RUPEES', owner: { email: 'nope' } });
      expect(res.status).toBe(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['name', 'baseCurrency', 'owner.email']));
    });

    it('searches and filters the list', async () => {
      const res = await as('super').get(`/platform/organizations?search=acme ${run}`).expect(200);
      expect(res.body.items.map((o: { name: string }) => o.name)).toEqual([`Acme ${run}`]);
      expect(res.body.items[0].memberCount).toBe(1);
      const suspended = await as('super').get(`/platform/organizations?search=${run}&status=SUSPENDED`).expect(200);
      expect(suspended.body.total).toBe(0);
    });

    it('shows details with owners and pending invitations', async () => {
      const created = await createOrg({ name: `Detail ${run}`, owner: { email: email('detailowner') } });
      const res = await as('super').get(`/platform/organizations/${created.body.organization.id}`).expect(200);
      expect(res.body.owners).toEqual([]);
      expect(res.body.pendingInvitations).toEqual([expect.objectContaining({ email: email('detailowner'), builtInRole: 'owner' })]);
      await as('super').get(`/platform/organizations/${randomUUID()}`).expect(404);
      await as('super').get('/platform/organizations/not-a-uuid').expect(400);
    });

    it('edits and records only what changed', async () => {
      const created = await createOrg({ name: `Edit ${run}`, owner: { email: email('e') } });
      const id = created.body.organization.id;
      const res = await as('super').patch(`/platform/organizations/${id}`, { name: `Edited ${run}`, fiscalYearStartMonth: 1 }).expect(200);
      expect(res.body).toMatchObject({ name: `Edited ${run}`, fiscalYearStartMonth: 1 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'platform.organization.update', entityId: id } });
      expect(audit.before).toEqual({ name: `Edit ${run}`, fiscalYearStartMonth: 4 });
      expect(audit.after).toEqual({ name: `Edited ${run}`, fiscalYearStartMonth: 1 });
      await as('super').patch(`/platform/organizations/${id}`, {}).expect(400);
    });

    it('suspends (locking members out) and reactivates', async () => {
      const created = await createOrg({ name: `Pause ${run}`, owner: { email: users.regular!.email } });
      const id = created.body.organization.id;
      const open = () => as('regular').get('/organization').set('X-Organization-Id', id);

      await open().expect(200);
      await as('super').post(`/platform/organizations/${id}/suspend`, { reason: 'Unpaid invoice' }).expect(200);
      await open().expect(403);
      await as('super').post(`/platform/organizations/${id}/suspend`).expect(409);
      await as('super').post(`/platform/organizations/${id}/reactivate`).expect(200);
      await open().expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'platform.organization.suspend', entityId: id } });
      expect(audit.after).toMatchObject({ status: 'SUSPENDED', reason: 'Unpaid invoice' });
    });
  });

  describe('accepting an invitation', () => {
    async function invite(name: string, ownerEmail: string) {
      const res = await createOrg({ name, owner: { email: ownerEmail } });
      extraEmails.push(ownerEmail);
      return { orgId: res.body.organization.id as string, token: tokenOf(res.body.owner.inviteUrl) };
    }
    const accept = (body: object) => http().post('/api/v1/invitations/accept').send(body);

    it('a new person previews, sets a password, and is signed in as Owner', async () => {
      const ownerEmail = email('joiner');
      const { orgId, token } = await invite(`Join ${run}`, ownerEmail);

      const preview = await http().post('/api/v1/invitations/preview').send({ token }).expect(200);
      expect(preview.body).toMatchObject({ organizationName: `Join ${run}`, email: ownerEmail, role: { type: 'built_in', key: 'owner' }, accountExists: false });

      await accept({ token, name: 'Joiner', password: 'weak' }).expect(400);
      const res = await accept({ token, name: 'Joiner', password: 'Joiner-Password-1' }).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).some((c) => c.startsWith('ln_refresh='))).toBe(true);

      const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body.organizations).toEqual([expect.objectContaining({ id: orgId, role: { type: 'built_in', key: 'owner' } })]);

      // The new account can sign in normally
      await http().post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Joiner-Password-1' }).expect(200);
    });

    it('a link works once', async () => {
      const { token } = await invite(`Once ${run}`, email('once'));
      await accept({ token, name: 'Once', password: 'Once-Password-12' }).expect(200);
      await accept({ token, name: 'Again', password: 'Once-Password-12' }).expect(410);
      await http().post('/api/v1/invitations/preview').send({ token }).expect(410);
    });

    it('two clicks at the same moment create only one account', async () => {
      const { token } = await invite(`Race ${run}`, email('race'));
      const results = await Promise.all([1, 2].map(() => accept({ token, name: 'Racer', password: 'Racer-Password-1' })));
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 410]);
      expect(await prisma.user.count({ where: { email: email('race') } })).toBe(1);
    });

    it('rejects unknown, expired and suspended-organisation links', async () => {
      await http().post('/api/v1/invitations/preview').send({ token: 'x'.repeat(43) }).expect(404);

      const expired = await invite(`Old ${run}`, email('old'));
      await prisma.invitation.updateMany({ where: { organizationId: expired.orgId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await accept({ token: expired.token, name: 'Old', password: 'Old-Password-123' }).expect(410);
      expect(res.body.message).toMatch(/expired/);

      const paused = await invite(`Paused ${run}`, email('paused'));
      await as('super').post(`/platform/organizations/${paused.orgId}/suspend`).expect(200);
      await accept({ token: paused.token, name: 'Paused', password: 'Paused-Password-1' }).expect(403);
    });

    it('existing account holders accept while signed in, and only for their own email', async () => {
      const org = await createOrg({ name: `Signed ${run}`, owner: { email: email('someone') } });
      const orgId = org.body.organization.id as string;
      const invitations = app.get(InvitationsService);
      const inv = await invitations.create(prisma, { organizationId: orgId, email: users.existingOwner!.email, role: { builtInRole: 'viewer' }, invitedById: users.super!.id });
      const token = tokenOf(inv.url);

      // The public path refuses: they must sign in instead (so it can't be used to guess passwords)
      await accept({ token, name: 'Someone', password: 'Some-Password-1' }).expect(409);
      expect((await http().post('/api/v1/invitations/preview').send({ token })).body.accountExists).toBe(true);

      await as('regular').post('/invitations/accept-signed-in', { token }).expect(403);
      await http().post('/api/v1/invitations/accept-signed-in').send({ token }).expect(401);
      const ok = await as('existingOwner').post('/invitations/accept-signed-in', { token }).expect(200);
      expect(ok.body).toEqual({ organizationId: orgId, organizationName: `Signed ${run}` });
      const m = await prisma.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: users.existingOwner!.id, organizationId: orgId } } });
      expect(m.builtInRole).toBe('viewer');
    });
  });

  describe('platform users', () => {
    beforeAll(async () => {
      // Park other active Super Admins in the test database so "last one" rules are deterministic
      const others = await prisma.user.findMany({ where: { isSuperAdmin: true, status: 'ACTIVE', id: { notIn: [users.super!.id, users.super2!.id] } }, select: { id: true } });
      parked = others.map((o) => o.id);
      await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isSuperAdmin: false } });
    });

    it('lists and searches users, Super Admins first', async () => {
      const res = await as('super').get(`/platform/users?search=${run}&pageSize=100`).expect(200);
      expect(res.body.items[0].isSuperAdmin).toBe(true);
      const sa = await as('super').get(`/platform/users?search=${run}&superAdmin=true`).expect(200);
      expect(sa.body.items.map((u: { email: string }) => u.email).sort()).toEqual([users.super!.email, users.super2!.email].sort());
      await as('regular').get('/platform/users').expect(403);
    });

    it('promotes and demotes, with audit', async () => {
      await as('super').post(`/platform/users/${users.regular!.id}/promote`).expect(200);
      await as('super').post(`/platform/users/${users.regular!.id}/promote`).expect(409);
      await as('regular').get('/platform/users').expect(200); // takes effect immediately
      await as('super').post(`/platform/users/${users.regular!.id}/demote`).expect(200);
      await as('regular').get('/platform/users').expect(403);
      expect(await prisma.auditLog.count({ where: { entityId: users.regular!.id, action: { in: ['platform.user.promote', 'platform.user.demote'] } } })).toBe(2);
    });

    it('never removes the last active Super Admin', async () => {
      await as('super').post(`/platform/users/${users.super2!.id}/demote`).expect(200);
      const res = await as('super').post(`/platform/users/${users.super!.id}/demote`).expect(409);
      expect(res.body.message).toMatch(/at least one active Super Admin/);
      expect(res.body.details).toEqual({ reason: 'last_super_admin' });
      await as('super').post(`/platform/users/${users.super2!.id}/promote`).expect(200);
    });

    it('two Super Admins demoting each other at the same instant leaves one standing', async () => {
      const results = await Promise.all([as('super').post(`/platform/users/${users.super2!.id}/demote`), as('super2').post(`/platform/users/${users.super!.id}/demote`)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { id: { in: [users.super!.id, users.super2!.id] }, isSuperAdmin: true } })).toBe(1);
      // Restore both
      const survivor = (await prisma.user.findFirstOrThrow({ where: { id: { in: [users.super!.id, users.super2!.id] }, isSuperAdmin: true } })).id;
      const other = survivor === users.super!.id ? users.super2!.id : users.super!.id;
      await prisma.user.update({ where: { id: other }, data: { isSuperAdmin: true } });
    });

    it('suspending a user ends their sessions at once; you cannot suspend yourself', async () => {
      await prisma.refreshToken.create({ data: { userId: users.regular!.id, familyId: randomUUID(), tokenHash: hashToken(`rt-${run}`), expiresAt: new Date(Date.now() + 86_400_000) } });
      await as('super').post(`/platform/users/${users.regular!.id}/suspend`, { reason: 'Left the company' }).expect(200);
      await as('regular').get('/auth/me').expect(401);
      expect(await prisma.refreshToken.count({ where: { userId: users.regular!.id, revokedAt: null } })).toBe(0);

      const self = await as('super').post(`/platform/users/${users.super!.id}/suspend`).expect(400);
      expect(self.body.details).toEqual({ reason: 'self' });
      await as('super').post(`/platform/users/${users.regular!.id}/reactivate`).expect(200);
      await as('regular').get('/auth/me').expect(200);
    });
  });

  describe('stats', () => {
    it('summarises the platform', async () => {
      const res = await as('super').get('/platform/stats').expect(200);
      expect(res.body.organizations.total).toBeGreaterThanOrEqual(orgIds.length);
      expect(res.body.organizations.total).toBe(res.body.organizations.active + res.body.organizations.suspended);
      expect(res.body.users.superAdmins).toBeGreaterThanOrEqual(1);
      expect(res.body.activity).toEqual({ signInsLast7Days: expect.any(Number), failedSignInsLast7Days: expect.any(Number) });
      expect(res.body.recent.length).toBeGreaterThan(0);
      expect(res.body.recent[0].action).toMatch(/^platform\./);
      await as('regular').get('/platform/stats').expect(403);
    });
  });
});
