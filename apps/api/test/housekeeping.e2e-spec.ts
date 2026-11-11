import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { HousekeepingService } from '../src/housekeeping/housekeeping.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Housekeeping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let userId = '';
  let org = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    userId = (
      await prisma.user.create({
        data: {
          email: `tidy-${run}@test.ledgernest.local`,
          name: 'Tidy',
          passwordHash: 'unused',
        },
      })
    ).id;
    org = (
      await prisma.organization.create({
        data: {
          name: `Tidy ${run}`,
          slug: `tidy-${run}`,
          country: 'IN',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('clears expired sign-in tokens, spent reset links and old webhook deliveries, and nothing still in use', async () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const day = 86_400_000;
    const at = (days: number) => new Date(now.getTime() + days * day);
    const family = randomUUID();
    for (const [expiresAt, key] of [
      [at(-3), 'old'],
      [at(-0.5), 'just-expired'],
      [at(10), 'live'],
    ] as const)
      await prisma.refreshToken.create({
        data: {
          userId,
          familyId: family,
          tokenHash: `${run}-${key}`,
          expiresAt,
        },
      });
    await prisma.passwordReset.createMany({
      data: [
        { userId, tokenHash: `${run}-r-expired`, expiresAt: at(-2) },
        {
          userId,
          tokenHash: `${run}-r-used`,
          expiresAt: at(1),
          usedAt: at(-2),
        },
        { userId, tokenHash: `${run}-r-live`, expiresAt: at(0.5) },
      ],
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        organizationId: org,
        url: 'https://example.invalid/hook',
        secret: 'x'.repeat(32),
        events: ['invoice.issued'],
      },
    });
    for (const [createdAt, status] of [
      [at(-100), 'succeeded'],
      [at(-100), 'pending'],
      [at(-10), 'failed'],
    ] as const)
      await prisma.webhookDelivery.create({
        data: {
          organizationId: org,
          endpointId: endpoint.id,
          event: 'invoice.issued',
          payload: {},
          status,
          createdAt,
        },
      });

    const removed = await app.get(HousekeepingService).run(now);
    expect(removed.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.refreshToken.findMany({ where: { familyId: family } }))
        .map((t) => t.tokenHash)
        .sort(),
    ).toEqual([`${run}-just-expired`, `${run}-live`]);
    expect(
      (await prisma.passwordReset.findMany({ where: { userId } })).map(
        (r) => r.tokenHash,
      ),
    ).toEqual([`${run}-r-live`]);
    // Old finished deliveries go; one still being retried stays, and so do recent ones
    expect(
      (
        await prisma.webhookDelivery.findMany({
          where: { organizationId: org },
          orderBy: { createdAt: 'asc' },
        })
      ).map((d) => d.status),
    ).toEqual(['pending', 'failed']);
  });
});
