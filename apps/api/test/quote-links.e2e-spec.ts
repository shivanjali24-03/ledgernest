import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Quote links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let customer = '';

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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const draft = (over: object = {}) => ({
    contactId: customer,
    quoteDate: '2026-06-01',
    expiryDate: '2026-06-30',
    reference: 'RFQ-17',
    lines: [
      {
        description: 'Warehouse racking',
        quantity: '4',
        unitPrice: 250_000,
        discount: 10,
        accountId: acc.sales,
      },
      {
        description: 'Installation',
        quantity: 1,
        unitPrice: 100_000,
        accountId: acc.sales,
      },
    ],
    ...over,
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
          name: `Quotes ${run}`,
          slug: `quote-links-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
      ['viewer', 'viewer'],
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
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await as()
        .post('/contacts', {
          name: 'Patil Cold Storage',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const pub = (token: string) => `/api/v1/public/quotes/${token}`;
  type Shared = {
    status: string;
    share: { token: string; views: number } | null;
    decidedBy: string | null;
    decisionNote: string | null;
  };

  it('shares a quote as a link (a draft is sent), which the customer opens and accepts', async () => {
    // Valid until well into the future, so it isn't expired whenever this runs
    const q = (
      await as()
        .post(
          '/quotes',
          draft({ quoteDate: '2026-06-01', expiryDate: '2099-12-31' }),
        )
        .expect(201)
    ).body as { id: string };
    await as('viewer').post(`/quotes/${q.id}/share`).expect(403);
    const s = (await as().post(`/quotes/${q.id}/share`).expect(200))
      .body as Shared;
    expect(s.status).toBe('sent');
    expect(s.share!.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const token = s.share!.token;
    const v = await http().get(pub(token)).expect(200);
    expect(v.headers['cache-control']).toBe('private, no-store');
    expect(v.body).toMatchObject({
      number: expect.stringMatching(/^QT-/),
      status: 'sent',
      state: 'sent',
      total: 1_000_000,
      reference: 'RFQ-17',
      lines: [
        expect.objectContaining({
          description: 'Warehouse racking',
          amount: 900_000,
        }),
        expect.objectContaining({ description: 'Installation' }),
      ],
    });
    await http()
      .get(`${pub(token)}/pdf`)
      .expect(200);
    await http()
      .post(pub(token))
      .send({ response: 'accept', name: 'R' })
      .expect(400);
    const done = await http()
      .post(pub(token))
      .send({
        response: 'accept',
        name: 'Ravi Kumar',
        note: 'Please start on Monday.',
      })
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'accepted',
      decidedBy: 'Ravi Kumar',
    });
    expect(
      (
        await http()
          .post(pub(token))
          .send({ response: 'decline', name: 'Ravi Kumar' })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'answered' });
    const after = (await as().get(`/quotes/${q.id}`).expect(200))
      .body as Shared;
    expect(after).toMatchObject({
      status: 'accepted',
      decidedBy: 'Ravi Kumar',
      decisionNote: 'Please start on Monday.',
      share: expect.objectContaining({ views: 1 }),
    });
  });

  it('won’t take an answer once the quote has expired, and stops when the link is turned off', async () => {
    const q = (
      await as()
        .post(
          '/quotes',
          draft({ quoteDate: '2026-05-01', expiryDate: '2026-05-15' }),
        )
        .expect(201)
    ).body as { id: string };
    const { share } = (await as().post(`/quotes/${q.id}/share`).expect(200))
      .body as Shared;
    expect((await http().get(pub(share!.token)).expect(200)).body.state).toBe(
      'expired',
    );
    expect(
      (
        await http()
          .post(pub(share!.token))
          .send({ response: 'accept', name: 'Ravi Kumar' })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'expired' });
    await as().delete(`/quotes/${q.id}/share`).expect(200);
    await http().get(pub(share!.token)).expect(404);
  });
});
