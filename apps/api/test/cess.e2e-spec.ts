import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('GST compensation cess (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let sales = '';
  let customer = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Cess ${run}`,
          slug: `cess-${run}`,
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
    token = await app
      .get(JwtService)
      .signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    await post('/accounts', {
      name: `debtors ${run}`,
      code: '1200',
      type: 'asset',
      subtype: 'accounts_receivable',
    }).expect(201);
    sales = (
      await post('/accounts', {
        name: `sales ${run}`,
        code: '4100',
        type: 'income',
        subtype: 'operating_income',
      }).expect(201)
    ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await post('/contacts', {
        name: 'Pune Beverages',
        isCustomer: true,
        isVendor: false,
        billingAddress: { country: 'IN', region: 'Maharashtra' },
      }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('needs GST set up at the rate first', async () => {
    expect(
      (
        await post('/taxes/gst-cess', {
          gstRatePpm: 280_000,
          cessRatePpm: 120_000,
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'gst_not_set_up' });
  });

  it('adds cess to GST 28%: cess accounts, the rate, and a group within the state and one between states', async () => {
    // 28% is retired since GST 2.0 (22 Sep 2025) except for tobacco, which still carries cess: set it up as well
    const slabs = await prisma.gstSlab.findMany({ select: { id: true } });
    await post('/taxes/gst-setup', { slabIds: slabs.map((x) => x.id) }).expect(
      200,
    );
    const r = (
      await post('/taxes/gst-cess', {
        gstRatePpm: 280_000,
        cessRatePpm: 120_000,
      }).expect(200)
    ).body as {
      created: { groups: string[] };
      groups: { name: string; supply: string; rates: { name: string }[] }[];
    };
    expect(r.created.groups).toEqual([
      'GST 28% + Cess 12%',
      'IGST 28% + Cess 12%',
    ]);
    const intra = r.groups.find((g) => g.name === 'GST 28% + Cess 12%')!;
    expect(intra.supply).toBe('intra');
    expect(intra.rates.map((x) => x.name)).toEqual([
      'CGST 14%',
      'SGST 14%',
      'Cess 12%',
    ]);
    // Again: nothing new
    expect(
      (
        await post('/taxes/gst-cess', {
          gstRatePpm: 280_000,
          cessRatePpm: 120_000,
        }).expect(200)
      ).body.created.groups,
    ).toEqual([]);
    expect(
      await prisma.account.count({
        where: { organizationId: org, code: { in: ['1350', '2150'] } },
      }),
    ).toBe(2);
  });

  it('charges cess on the invoice and reports it in GSTR-1 and GSTR-3B', async () => {
    const groups = (await get('/taxes').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    const g = groups.find((x) => x.name === 'GST 28% + Cess 12%')!.id;
    const d = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-06-10',
        lines: [
          {
            description: 'Pan masala',
            quantity: 1,
            unitPrice: 10_000_00,
            taxGroupId: g,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as {
      id: string;
      taxTotal: number;
      taxBreakdown: { name: string; amount: number }[];
    };
    expect(d.taxTotal).toBe(4_000_00);
    expect(d.taxBreakdown).toEqual(
      expect.arrayContaining([{ name: 'Cess 12%', amount: 1_200_00 }]),
    );
    await post(`/invoices/${d.id}/issue`).expect(200);
    const r1 = (
      await get('/reports/gst/gstr-1?from=2026-06-01&to=2026-06-30').expect(200)
    ).body as { b2cs: { cess: number }[] };
    expect(r1.b2cs.reduce((s, x) => s + x.cess, 0)).toBe(1_200_00);
    const r3b = (
      await get('/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30').expect(
        200,
      )
    ).body as Record<string, unknown>;
    expect(JSON.stringify(r3b)).toContain('"cess":120000');
  });
});
