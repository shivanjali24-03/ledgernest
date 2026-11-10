import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Bills entered twice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const vendor: Record<string, string> = {};
  let org = '';
  let token = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const record = async (
    contactId: string,
    vendorReference: string,
    billDate: string,
    unitPrice: number,
    dueDate?: string,
  ) => {
    const b = (
      await post('/bills', {
        contactId,
        vendorReference,
        billDate,
        ...(dueDate ? { dueDate } : {}),
        lines: [
          {
            description: 'Fabrication',
            quantity: 1,
            unitPrice,
            accountId: acc.jobwork,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/bills/${b.id}/record`).expect(200);
    return b.id;
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
          name: `Duplicates ${run}`,
          slug: `dupes-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    const u = await prisma.user.create({
      data: {
        email: `owner-${run}@test.ledgernest.local`,
        name: 'Owner',
        passwordHash: 'unused',
      },
    });
    await prisma.membership.create({
      data: { userId: u.id, organizationId: org, builtInRole: 'owner' },
    });
    token = await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['jobwork', { code: '5100', type: 'expense', subtype: 'cost_of_sales' }],
    ] as const) {
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    }
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const draft = async (
    vendorReference: string | null,
    billDate: string,
    unitPrice: number,
  ) =>
    (
      (
        await post('/bills', {
          contactId: vendor.sharma,
          ...(vendorReference ? { vendorReference } : {}),
          billDate,
          lines: [
            {
              description: 'Fabrication',
              quantity: 1,
              unitPrice,
              accountId: acc.jobwork,
            },
          ],
        }).expect(201)
      ).body as { id: string }
    ).id;

  it('won’t record the same vendor bill number twice unless told to', async () => {
    vendor.sharma = (
      await post('/contacts', {
        name: 'Sharma Fabricators',
        isVendor: true,
        isCustomer: false,
      }).expect(201)
    ).body.id;
    const first = await record(
      vendor.sharma,
      'SOS/887',
      '2026-10-01',
      45_000_00,
    );
    expect(first).toEqual(expect.any(String));
    const again = await draft('sos 0887', '2026-10-03', 45_000_00);
    const r = await post(`/bills/${again}/record`).expect(409);
    expect(r.body.details).toMatchObject({
      reason: 'duplicate_bill',
      duplicates: [
        expect.objectContaining({
          id: first,
          number: 'BILL/2026-27/0001',
          reason: 'reference',
        }),
      ],
    });
    expect(r.body.message).toContain('recorded already as BILL/2026-27/0001');
    // A different number goes through; the same one only when confirmed
    await post(`/bills/${again}/record`, { allowDuplicate: true }).expect(200);
  });

  it('lists likely duplicates for a draft: the same number, or the same total within three days', async () => {
    const noRef = await draft(null, '2026-10-02', 45_000_00);
    const list = (await get(`/bills/${noRef}/duplicates`).expect(200)).body as {
      vendorReference: string | null;
      reason: string;
      status: string;
    }[];
    expect(list.map((d) => [d.vendorReference, d.reason])).toEqual([
      ['sos 0887', 'amount'],
      ['SOS/887', 'amount'],
    ]);
    const other = await draft('SOS/900', '2026-10-02', 45_000_00);
    expect(
      ((await get(`/bills/${other}/duplicates`).expect(200)).body as unknown[])
        .length,
    ).toBe(1);
  });
});
