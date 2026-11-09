import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Key = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  key?: string;
};

describe('API keys (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let org = '';
  let other = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const withKey = (key: string, orgId?: string) => {
    const auth = (r: request.Test) =>
      (orgId ? r.set('X-Organization-Id', orgId) : r).set(
        'Authorization',
        `Bearer ${key}`,
      );
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Keys ${run}`,
          slug: `keys-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    other = (
      await prisma.organization.create({
        data: {
          name: `Other ${run}`,
          slug: `keys-other-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['admin', 'admin'],
      ['accountant', 'accountant'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: `User ${key}`,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = {
        id: u.id,
        token: await jwt.signAsync(
          { sub: u.id, sa: false },
          { expiresIn: '15m' },
        ),
      };
    }
    await prisma.membership.create({
      data: {
        userId: users.owner!.id,
        organizationId: other,
        builtInRole: 'owner',
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [org, other] } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let readKey = '';
  let readId = '';

  it('is made by Owners and Admins, shown once, and kept only as a hash', async () => {
    await as('accountant')
      .post('/api-keys', { name: 'Shop', scopes: ['contacts.view'] })
      .expect(403);
    await as()
      .post('/api-keys', { name: 'Shop', scopes: ['users.manage'] })
      .expect(400);
    const k = (
      await as()
        .post('/api-keys', {
          name: 'Online shop',
          scopes: ['contacts.view', 'invoices.view'],
        })
        .expect(201)
    ).body as Key;
    expect(k.key).toMatch(/^lnk_[A-Za-z0-9_-]{40}$/);
    expect(k.key!.startsWith(k.prefix)).toBe(true);
    readKey = k.key!;
    readId = k.id;
    const list = (await as().get('/api-keys').expect(200)).body as Key[];
    expect(list[0]).toMatchObject({
      name: 'Online shop',
      status: 'active',
      scopes: ['contacts.view', 'invoices.view'],
    });
    expect(JSON.stringify(list)).not.toContain(readKey);
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: readId } })).hash,
    ).not.toContain(readKey.slice(4));
  });

  it('works in its own organisation only, within its scopes', async () => {
    expect(
      (await withKey(readKey).get('/contacts').expect(200)).body.items,
    ).toEqual([]);
    expect(
      (await withKey(readKey, org).get('/invoices').expect(200)).body.total,
    ).toBe(0);
    expect(
      (
        await withKey(readKey)
          .post('/contacts', { name: 'Kumar Logistics', isCustomer: true })
          .expect(403)
      ).body.details.missing,
    ).toEqual(['contacts.manage']);
    await withKey(readKey).get('/bills').expect(403);
    await withKey(readKey, other).get('/contacts').expect(404);
    await withKey(readKey).get('/api-keys').expect(403);
    await withKey(readKey).get('/platform/organizations').expect(403);
    await withKey('lnk_not-a-real-key').get('/contacts').expect(401);
  });

  it('never does more than its maker can now, says it acted in the audit trail, and stops when revoked or expired', async () => {
    const k = (
      await as('admin')
        .post('/api-keys', {
          name: 'CRM sync',
          scopes: ['contacts.view', 'contacts.manage'],
        })
        .expect(201)
    ).body as Key;
    const c = await withKey(k.key!)
      .post('/contacts', {
        name: 'Sharma Office Supplies',
        isCustomer: false,
        isVendor: true,
      })
      .expect(201);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: {
        organizationId: org,
        action: 'org.contact.create',
        entityId: c.body.id,
      },
    });
    expect(log).toMatchObject({
      actorId: users.admin!.id,
      userAgent: `API key ${k.prefix}… · CRM sync`,
    });
    // The admin becomes a Viewer: the key loses what they lost
    await prisma.membership.updateMany({
      where: { userId: users.admin!.id, organizationId: org },
      data: { builtInRole: 'viewer' },
    });
    await withKey(k.key!).get('/contacts').expect(403);

    await as().delete(`/api-keys/${readId}`).expect(204);
    await as().delete(`/api-keys/${readId}`).expect(409);
    await withKey(readKey).get('/contacts').expect(401);
    const exp = (
      await as()
        .post('/api-keys', {
          name: 'Short',
          scopes: ['contacts.view'],
          expiresInDays: 1,
        })
        .expect(201)
    ).body as Key;
    await prisma.apiKey.update({
      where: { id: exp.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await withKey(exp.key!).get('/contacts').expect(401);
    expect(
      ((await as().get('/api-keys').expect(200)).body as Key[])
        .map((x) => x.status)
        .sort(),
    ).toEqual(['active', 'expired', 'revoked']);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.api_key.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.api_key.create', 'org.api_key.revoke']),
    );
  });
});
