import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Organisations that require two-factor sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string) => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
    };
  };
  const twoFactorOn = (who: string) =>
    prisma.user.update({
      where: { id: users[who]!.id },
      data: { totpEnabledAt: new Date() },
    });

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
          name: `Strict ${run}`,
          slug: `strict-${run}`,
          country: 'IN',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['staff', 'accountant'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: key,
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
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('can only be required by someone who uses it already', async () => {
    expect(
      (
        await as('owner')
          .patch('/organization', { requireTwoFactor: true })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'two_factor_self' });
    await twoFactorOn('owner');
    expect(
      (
        await as('owner')
          .patch('/organization', { requireTwoFactor: true })
          .expect(200)
      ).body,
    ).toMatchObject({ requireTwoFactor: true });
  });

  it('keeps members without it out until they turn it on, and says why', async () => {
    expect(
      (await as('staff').get('/accounts').expect(403)).body.details,
    ).toMatchObject({ reason: 'two_factor_required' });
    // Their own profile still loads, saying what's needed
    const me = (await as('staff').get('/auth/me').expect(200)).body as {
      user: { twoFactorEnabled: boolean };
      organizations: { id: string; requireTwoFactor: boolean }[];
    };
    expect(me.user.twoFactorEnabled).toBe(false);
    expect(me.organizations.find((o) => o.id === org)).toMatchObject({
      requireTwoFactor: true,
    });
    await as('owner').get('/accounts').expect(200);
    await twoFactorOn('staff');
    await as('staff').get('/accounts').expect(200);
  });
});
