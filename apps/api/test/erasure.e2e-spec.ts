import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const PASSWORD = 'Correct-Horse-42';

describe('Deleting an organisation, and your own account (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, organizationId = org) => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', organizationId);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      delete: (p: string, body: object = {}) =>
        auth(http().delete(`/api/v1${p}`)).send(body),
    };
  };
  const makeUser = async (key: string) => {
    const u = await prisma.user.create({
      data: {
        email: `${key}-${run}@test.ledgernest.local`,
        name: `User ${key}`,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      },
    });
    users[key] = {
      id: u.id,
      token: await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      ),
    };
    return u.id;
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
          name: `Erasure ${run}`,
          slug: `erasure-${run}`,
          country: 'IN',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['admin', 'admin'],
      ['leaver', 'owner'],
    ] as const) {
      await makeUser(key);
      await prisma.membership.create({
        data: {
          userId: users[key]!.id,
          organizationId: org,
          builtInRole: role,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: `-${run}@test.ledgernest.local` } },
          { id: { in: Object.values(users).map((u) => u.id) } },
        ],
      },
    });
    await app.close();
  });

  it('erases your own account but keeps what you did, credited to a deleted user', async () => {
    // The leaver posts something first
    const account = (
      await as('leaver')
        .post('/accounts', {
          name: `Petty cash ${run}`,
          code: '1050',
          type: 'asset',
          subtype: 'cash',
        })
        .expect(201)
    ).body.id as string;
    await as('leaver')
      .post('/auth/delete-account', { password: 'Wrong-Pass-1' })
      .expect(400);
    await as('leaver')
      .post('/auth/delete-account', { password: PASSWORD })
      .expect(204);
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: users.leaver!.id },
    });
    expect(u).toMatchObject({
      name: 'Deleted user',
      email: `deleted-${u.id}@deleted.invalid`,
      status: 'SUSPENDED',
      isSuperAdmin: false,
    });
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(0);
    // Can't sign in with the old email or password
    await http()
      .post('/api/v1/auth/login')
      .send({
        email: `leaver-${run}@test.ledgernest.local`,
        password: PASSWORD,
      })
      .expect(401);
    // The books are untouched
    expect(
      await prisma.account.findUnique({ where: { id: account } }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { actorId: u.id, action: 'user.deleted' },
      }),
    ).toBe(1);
  });

  it('won’t leave an organisation with no Owner', async () => {
    expect(
      (
        await as('owner')
          .post('/auth/delete-account', { password: PASSWORD })
          .expect(409)
      ).body.details,
    ).toMatchObject({
      reason: 'sole_owner',
      organizations: [`Erasure ${run}`],
    });
  });

  it('deletes the organisation and everything in it for an Owner who types its name', async () => {
    await as('admin')
      .delete('/organization', { confirmName: `Erasure ${run}` })
      .expect(403);
    expect(
      (
        await as('owner')
          .delete('/organization', { confirmName: 'erasure' })
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'name_mismatch' });
    const before = await prisma.auditLog.count({
      where: { organizationId: org },
    });
    expect(before).toBeGreaterThan(0);
    await as('owner')
      .delete('/organization', { confirmName: `Erasure ${run}` })
      .expect(204);
    expect(
      await prisma.organization.findUnique({ where: { id: org } }),
    ).toBeNull();
    expect(await prisma.account.count({ where: { organizationId: org } })).toBe(
      0,
    );
    // The trail stays: a platform entry for the deletion, and the organisation's own entries untied from it
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'organization.deleted',
          entityId: org,
          organizationId: null,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: org } }),
    ).toBeGreaterThan(0);
    // With the organisation gone, the Owner can now leave too
    await as('owner')
      .post('/auth/delete-account', { password: PASSWORD })
      .expect(204);
  });
});
