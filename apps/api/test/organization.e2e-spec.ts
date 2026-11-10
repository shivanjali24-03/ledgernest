import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

// Smallest valid images: an 8-byte PNG signature and a 4-byte JPEG start are all the checks look at
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);

describe('Organisation settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let orgA = '';
  let orgB = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org).send(body),
    del: (path: string) => http().delete(`/api/v1${path}`).set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org),
  });
  const audits = (action: string) => prisma.auditLog.findMany({ where: { action, organizationId: orgA }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    orgA = (await prisma.organization.create({ data: { name: `Settings A ${run}`, slug: `settings-a-${run}` } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Settings B ${run}`, slug: `settings-b-${run}` } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['admin', orgA, 'admin'],
      ['viewer', orgA, 'viewer'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('shows settings, the address, what is locked, and your access', async () => {
    const res = await as('viewer', orgA).get('/organization').expect(200);
    expect(res.body.organization).toMatchObject({
      id: orgA,
      timeZone: 'Asia/Kolkata',
      address: { line1: null, line2: null, city: null, region: null, postalCode: null },
      logo: null,
      locks: { baseCurrency: false, fiscalYearStartMonth: false },
    });
    expect(res.body.access.permissions).toContain('org.settings.view');
  });

  it('Owners and Admins change settings; only real changes are written and audited', async () => {
    const res = await as('admin', orgA)
      .patch('/organization', { legalName: 'Settings A Private Limited', taxId: '27aapfu0939f1zv', timeZone: 'Asia/Kolkata', address: { city: 'Pune', region: 'Maharashtra' } })
      .expect(200);
    expect(res.body).toMatchObject({ legalName: 'Settings A Private Limited', taxId: '27AAPFU0939F1ZV', address: { city: 'Pune', region: 'Maharashtra', line1: null } });

    const [entry] = await audits('org.settings.update');
    // The time zone was sent but didn't change, so it isn't recorded
    expect(entry).toMatchObject({
      actorId: users.admin!.id,
      before: { legalName: null, taxId: null, city: null, region: null },
      after: { legalName: 'Settings A Private Limited', taxId: '27AAPFU0939F1ZV', city: 'Pune', region: 'Maharashtra' },
    });

    await as('owner', orgA).patch('/organization', { address: { city: 'Pune' } }).expect(200);
    expect(await audits('org.settings.update')).toHaveLength(1);
  });

  it('keeps the terms printed on invoices and quotes, up to 1,000 characters', async () => {
    const terms = 'Payment within 15 days.\nBank: HDFC Bank, Baner · A/c 50200012345678 · IFSC HDFC0001234';
    expect((await as('owner', orgA).patch('/organization', { invoiceTerms: terms }).expect(200)).body.invoiceTerms).toBe(terms);
    expect((await as('viewer', orgA).get('/organization').expect(200)).body.organization.invoiceTerms).toBe(terms);
    await as('owner', orgA).patch('/organization', { invoiceTerms: 'x'.repeat(1001) }).expect(400);
    expect((await as('owner', orgA).patch('/organization', { invoiceTerms: '  ' }).expect(200)).body.invoiceTerms).toBeNull();
  });

  it('refuses invalid values, and never lets an organisation change its web address', async () => {
    const bad = await as('owner', orgA).patch('/organization', { timeZone: 'Mars/Olympus', baseCurrency: 'XX' }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/timeZone/);
    await as('owner', orgA).patch('/organization', { slug: 'stolen-slug' }).expect(400);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).slug).toBe(`settings-a-${run}`);
  });

  it('Viewers cannot change settings, and nobody changes another organisation', async () => {
    const res = await as('viewer', orgA).patch('/organization', { name: 'Hijacked' }).expect(403);
    expect(res.body.details).toEqual({ missing: ['org.settings.manage'] });
    await as('ownerB', orgA).patch('/organization', { name: 'Hijacked' }).expect(404);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).name).toBe(`Settings A ${run}`);
  });

  describe('logo', () => {
    it('uploads, serves and removes a logo, auditing each change', async () => {
      const res = await as('owner', orgA).put('/organization/logo', { type: 'image/png', data: PNG.toString('base64') }).expect(200);
      expect(res.body.logo).toMatchObject({ contentType: 'image/png' });

      const img = await as('viewer', orgA).get('/organization/logo').buffer(true).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

      await as('owner', orgA).del('/organization/logo').expect(204);
      await as('viewer', orgA).get('/organization/logo').expect(404);
      expect((await audits('org.logo.update'))[0]).toMatchObject({ after: { contentType: 'image/png', bytes: PNG.length } });
      expect(await audits('org.logo.remove')).toHaveLength(1);
    });

    it('accepts a logo up to 256 KB, past the usual 100 KB request limit', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(250 * 1024)]);
      await as('owner', orgA).put('/organization/logo', { type: 'image/png', data: big.toString('base64') }).expect(200);
    });

    it('refuses files that are not what they claim, SVGs, and oversized images', async () => {
      const mismatch = await as('owner', orgA).put('/organization/logo', { type: 'image/png', data: JPEG.toString('base64') }).expect(400);
      expect(mismatch.body.details).toEqual({ reason: 'type_mismatch' });
      await as('owner', orgA).put('/organization/logo', { type: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }).expect(400);
      const huge = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
      // Refused by the request size limit before it's even parsed
      await as('owner', orgA).put('/organization/logo', { type: 'image/png', data: huge.toString('base64') }).expect(413);
      await as('viewer', orgA).put('/organization/logo', { type: 'image/png', data: PNG.toString('base64') }).expect(403);
    });

    it('the database itself refuses other image types', async () => {
      await expect(prisma.organizationLogo.upsert({ where: { organizationId: orgB }, create: { organizationId: orgB, contentType: 'image/svg+xml', data: PNG }, update: {} })).rejects.toThrow(
        /organization_logos_content_type_check/,
      );
    });

    it("never serves another organisation's logo", async () => {
      await as('owner', orgA).put('/organization/logo', { type: 'image/png', data: PNG.toString('base64') }).expect(200);
      await as('ownerB', orgB).get('/organization/logo').expect(404);
    });
  });

  it('settings changes have their own audit filter', async () => {
    const res = await as('owner', orgA).get('/organization/audit?group=settings').expect(200);
    const actions = new Set(res.body.items.map((i: { action: string }) => i.action));
    expect([...actions].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['org.logo.remove', 'org.logo.update', 'org.settings.update']);
  });
});
