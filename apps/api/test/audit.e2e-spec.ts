import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; email: string; token: string }> = {};
  let orgA = '';
  let orgB = '';

  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string, org?: string) => {
    const r = http().get(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`);
    return org ? r.set('X-Organization-Id', org) : r;
  };
  const email = (k: string) => `${k.toLowerCase()}-${run}@test.ledgernest.local`;
  async function makeUser(key: string, isSuperAdmin = false) {
    const u = await prisma.user.create({ data: { email: email(key), name: `User ${key}`, passwordHash: 'unused', isSuperAdmin } });
    users[key] = { id: u.id, email: u.email, token: await jwt.signAsync({ sub: u.id, sa: isSuperAdmin }, { expiresIn: '15m' }) };
  }
  /** Writes an entry directly, optionally in the past (inserting is the only thing the log allows). */
  const entry = (action: string, opts: { org?: string; actor?: string; at?: Date; entityId?: string } = {}) =>
    prisma.auditLog.create({ data: { action, organizationId: opts.org ?? null, actorId: opts.actor ? users[opts.actor]!.id : null, createdAt: opts.at, entityId: opts.entityId } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    orgA = (await prisma.organization.create({ data: { name: `Audit A ${run}`, slug: `audit-a-${run}` } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Audit B ${run}`, slug: `audit-b-${run}` } })).id;
    for (const k of ['owner', 'auditor', 'viewer', 'ownerB']) await makeUser(k);
    await makeUser('super', true);
    await prisma.membership.createMany({
      data: [
        { userId: users.owner!.id, organizationId: orgA, builtInRole: 'owner' },
        { userId: users.auditor!.id, organizationId: orgA, builtInRole: 'auditor' },
        { userId: users.viewer!.id, organizationId: orgA, builtInRole: 'viewer' },
        { userId: users.ownerB!.id, organizationId: orgB, builtInRole: 'owner' },
      ],
    });

    // Real activity through the API
    await http().post('/api/v1/organization/invitations').set('Authorization', `Bearer ${users.owner!.token}`).set('X-Organization-Id', orgA).send({ email: email('invitee'), role: { builtInRole: 'viewer' } }).expect(201);
    await http().post('/api/v1/organization/roles').set('Authorization', `Bearer ${users.owner!.token}`).set('X-Organization-Id', orgA).send({ name: `Audit role ${run}`, permissions: ['reports.view'] }).expect(201);
    await get('super', '/organization', orgA).expect(200); // support access, audited for org A
    await http().post('/api/v1/organization/roles').set('Authorization', `Bearer ${users.ownerB!.token}`).set('X-Organization-Id', orgB).send({ name: `B role ${run}`, permissions: ['reports.view'] }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  describe('append-only storage (enforced by the database)', () => {
    it('refuses to edit, delete or truncate entries', async () => {
      const e = await entry('org.test.immutable', { org: orgA, actor: 'owner' });
      await expect(prisma.auditLog.update({ where: { id: e.id }, data: { action: 'org.test.rewritten' } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditLog.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditLog.deleteMany({ where: { organizationId: orgA } })).rejects.toThrow(/append-only/);
      // Inside a transaction that is always rolled back, so even a broken trigger could not wipe the test log
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('TRUNCATE audit_logs');
          throw new Error('trigger missing: rolled back');
        }),
      ).rejects.toThrow(/append-only/);
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: e.id } })).action).toBe('org.test.immutable');
    });

    it("records the actor's email automatically, and keeps it after the user is deleted", async () => {
      await makeUser('leaver');
      const e = await entry('org.test.leaver', { org: orgA, actor: 'leaver' });
      expect(e.actorEmail).toBe(email('leaver'));
      await prisma.user.delete({ where: { id: users.leaver!.id } }); // the database may only clear the reference
      const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: e.id } });
      expect(after).toMatchObject({ actorId: null, actorEmail: email('leaver'), action: 'org.test.leaver' });
    });
  });

  describe('organisation log', () => {
    it("shows only this organisation's history, newest first, including Super Admin visits", async () => {
      const res = await get('owner', '/organization/audit', orgA).expect(200);
      const actions = res.body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(expect.arrayContaining(['org.invitation.create', 'org.role.create', 'platform.support_access']));
      expect(res.body.items.every((i: { organization?: unknown }) => i.organization === undefined)).toBe(true);
      const times = res.body.items.map((i: { createdAt: string }) => Date.parse(i.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const support = res.body.items.find((i: { action: string }) => i.action === 'platform.support_access');
      expect(support.actor).toMatchObject({ email: email('super') });
      // Org B's activity never appears
      expect(res.body.items.some((i: { after?: { name?: string } }) => i.after?.name === `B role ${run}`)).toBe(false);
    });

    it('Auditors can read it; Viewers cannot', async () => {
      await get('auditor', '/organization/audit', orgA).expect(200);
      const res = await get('viewer', '/organization/audit', orgA).expect(403);
      expect(res.body.details).toEqual({ missing: ['audit.view'] });
    });

    it('filters by kind of action, person and date', async () => {
      const inv = await get('owner', '/organization/audit?group=invitations', orgA).expect(200);
      expect(inv.body.items.length).toBeGreaterThan(0);
      expect(inv.body.items.every((i: { action: string }) => i.action.startsWith('org.invitation.') || i.action.startsWith('invitation.'))).toBe(true);

      const bySuper = await get('owner', `/organization/audit?actorId=${users.super!.id}`, orgA).expect(200);
      expect(bySuper.body.items.every((i: { actor: { email: string } }) => i.actor.email === email('super'))).toBe(true);

      await entry('org.test.dated', { org: orgA, at: new Date('2026-01-15T10:00:00Z') });
      const jan = await get('owner', '/organization/audit?from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z', orgA).expect(200);
      expect(jan.body.items.map((i: { action: string }) => i.action)).toEqual(['org.test.dated']);
    });

    it('pages with a stable cursor and no duplicates', async () => {
      for (let i = 0; i < 7; i++) await entry('org.test.page', { org: orgA, at: new Date(Date.UTC(2025, 5, 1, 0, 0, i)) });
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await get('owner', `/organization/audit?from=2025-06-01T00:00:00Z&to=2025-06-01T23:59:59Z&limit=3${cursor ? `&cursor=${cursor}` : ''}`, orgA).expect(200);
        seen.push(...res.body.items.map((i: { id: string }) => i.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      await get('owner', '/organization/audit?cursor=garbage', orgA).expect(400);
    });

    it("lists the people in this organisation's log, for the person filter", async () => {
      const res = await get('auditor', '/organization/audit/actors', orgA).expect(200);
      const emails = res.body.map((a: { email: string }) => a.email);
      expect(emails).toEqual(expect.arrayContaining([email('owner'), email('super')]));
      expect(emails).not.toContain(email('ownerB'));
      await get('viewer', '/organization/audit/actors', orgA).expect(403);
    });

    it('exports CSV safely, and the export itself is audited', async () => {
      await entry('org.test.csv', { org: orgA, entityId: '=HYPERLINK("http://evil.example","click")' });
      const res = await get('owner', '/organization/audit/export?group=exports', orgA).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);

      const all = await get('owner', '/organization/audit/export', orgA).expect(200);
      expect(all.text.startsWith('\uFEFF"time","action","actor","entity_type"')).toBe(true);
      expect(all.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
      expect(all.text).not.toContain(`B role ${run}`);

      expect(await prisma.auditLog.count({ where: { action: 'org.audit.export', organizationId: orgA, actorId: users.owner!.id } })).toBe(2);
    });
  });

  describe('platform log', () => {
    it('is for Super Admins only', async () => {
      await get('owner', '/platform/audit').expect(403);
    });

    it('covers every organisation, names them, and can be narrowed to one', async () => {
      const all = await get('super', `/platform/audit?limit=100&actorId=${users.ownerB!.id}`).expect(200);
      expect(all.body.items[0].organization).toMatchObject({ id: orgB, name: `Audit B ${run}` });

      const onlyA = await get('super', `/platform/audit?organizationId=${orgA}&limit=100`).expect(200);
      expect(onlyA.body.items.every((i: { organization: { id: string } | null }) => i.organization?.id === orgA)).toBe(true);
    });

    it('lists people across every organisation', async () => {
      const res = await get('super', '/platform/audit/actors').expect(200);
      const emails = res.body.map((a: { email: string }) => a.email);
      expect(emails).toEqual(expect.arrayContaining([email('owner'), email('ownerB')]));
      await get('owner', '/platform/audit/actors').expect(403);
    });

    it('exports with the organisation column', async () => {
      const res = await get('super', `/platform/audit/export?organizationId=${orgB}`).expect(200);
      expect(res.text).toContain('"organization"');
      expect(res.text).toContain(`"Audit B ${run}"`);
      expect(await prisma.auditLog.count({ where: { action: 'platform.audit.export', actorId: users.super!.id } })).toBe(1);
    });
  });
});
