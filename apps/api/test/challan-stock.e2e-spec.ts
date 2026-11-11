import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Challan = {
  id: string;
  number: string;
  status: string;
  goods: {
    dispatchedAt: string | null;
    backAt: string | null;
    backReason: string | null;
    jobWorkDue: string | null;
  } | null;
};

/** Delivery challans move goods out of stock and back, and an invoice made from one sells what left on it */
describe('Delivery challans and stock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let customer = '';
  let pump = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const challan = async (purpose: string, quantity: string, itemId = pump) =>
    (
      await post('/quotes', {
        contactId: customer,
        kind: 'delivery_challan',
        purpose,
        quoteDate: '2026-06-05',
        expiryDate: '2026-06-05',
        lines: [
          {
            itemId,
            description: 'Pump',
            quantity,
            unitPrice: 2_500_00,
            accountId: acc.sales,
          },
        ],
      }).expect(201)
    ).body as Challan;
  const onHand = async () =>
    (
      (await get(`/inventory/items/${pump}/movements`).expect(200)).body as {
        movements: { kind: string; onHand: string; valueOnHand: number }[];
      }
    ).movements.at(-1)!;
  const balance = async (systemKey: string) => {
    const a = await prisma.account.findFirst({
      where: { organizationId: org, systemKey },
      select: { id: true },
    });
    if (!a) return 0;
    const s = await prisma.journalLine.aggregate({
      where: { accountId: a.id, entry: { status: 'posted' } },
      _sum: { debit: true, credit: true },
    });
    return Number((s._sum.debit ?? 0n) - (s._sum.credit ?? 0n));
  };

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
          name: `Challan stock ${run}`,
          slug: `challan-stock-${run}`,
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
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['stock', { code: '1500', type: 'asset', subtype: 'inventory' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await post('/contacts', {
        name: 'Deshmukh Farms',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    const vendor = (
      await post('/contacts', {
        name: 'Kirloskar Dealers',
        isCustomer: false,
        isVendor: true,
      }).expect(201)
    ).body.id;
    pump = (
      await post('/items', {
        name: 'Pump',
        kind: 'goods',
        unit: 'NOS',
        trackStock: true,
        inventoryAccountId: acc.stock,
        cogsAccountId: acc.cogs,
      }).expect(201)
    ).body.id;
    // Ten pumps in at ₹1,000
    const bill = (
      await post('/bills', {
        contactId: vendor,
        billDate: '2026-06-01',
        lines: [
          {
            itemId: pump,
            description: 'Pump',
            quantity: 10,
            unitPrice: 1_000_00,
            accountId: acc.stock,
          },
        ],
      }).expect(201)
    ).body.id;
    await post(`/bills/${bill}/record`).expect(200);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('sends pumps out for job work: they leave stock but stay ours, due back within a year, and come back', async () => {
    const dc = await challan('job_work', '3');
    expect(dc.goods).toMatchObject({ dispatchedAt: null, backAt: null });
    // Not before the challan's date
    await post(`/quotes/${dc.id}/dispatch`, { date: '2026-06-01' }).expect(400);
    const out = (
      await post(`/quotes/${dc.id}/dispatch`, { date: '2026-06-06' }).expect(
        200,
      )
    ).body as Challan;
    expect(out.status).toBe('sent');
    expect(out.goods).toMatchObject({
      dispatchedAt: '2026-06-06',
      jobWorkDue: '2027-06-06',
    });
    expect(await onHand()).toMatchObject({
      kind: 'challan_out',
      onHand: '7',
      valueOnHand: 7_000_00,
    });
    expect(await balance('goods_on_challan')).toBe(3_000_00);
    // Once only, and not reworked while the goods are out
    expect(
      (await post(`/quotes/${dc.id}/dispatch`, {}).expect(409)).body.details,
    ).toMatchObject({ reason: 'challan_dispatched' });
    expect(
      (await post(`/quotes/${dc.id}/status`, { status: 'draft' }).expect(409))
        .body.details,
    ).toMatchObject({ reason: 'challan_dispatched' });
    const back = (
      await post(`/quotes/${dc.id}/goods-back`, { date: '2026-06-20' }).expect(
        200,
      )
    ).body as Challan;
    expect(back.goods).toMatchObject({
      backAt: '2026-06-20',
      backReason: 'returned',
      jobWorkDue: null,
    });
    expect(await onHand()).toMatchObject({
      kind: 'challan_back',
      onHand: '10',
      valueOnHand: 10_000_00,
    });
    expect(await balance('goods_on_challan')).toBe(0);
    await post(`/quotes/${dc.id}/goods-back`, {}).expect(409);
  });

  it('sells pumps sent on approval from the invoice made from the challan, without taking them twice', async () => {
    const dc = await challan('approval', '2');
    await post(`/quotes/${dc.id}/dispatch`, { date: '2026-06-21' }).expect(200);
    expect((await onHand()).onHand).toBe('8');
    const { invoiceId } = (
      await post(`/quotes/${dc.id}/convert`, {
        issueDate: '2026-06-25',
      }).expect(200)
    ).body as { invoiceId: string };
    await post(`/invoices/${invoiceId}/issue`).expect(200);
    expect(await onHand()).toMatchObject({
      kind: 'invoice',
      onHand: '8',
      valueOnHand: 8_000_00,
    });
    expect(await balance('goods_on_challan')).toBe(0);
    const after = (await get(`/quotes/${dc.id}`).expect(200)).body as Challan;
    expect(after.goods).toMatchObject({
      backAt: '2026-06-25',
      backReason: 'invoiced',
    });
    const cogs = await prisma.journalLine.aggregate({
      where: { accountId: acc.cogs },
      _sum: { debit: true },
    });
    expect(Number(cogs._sum.debit)).toBe(2_000_00);
  });

  it('refuses to dispatch a challan with nothing kept in stock, or more than is on hand', async () => {
    const service = (
      await post('/items', { name: 'Installation', kind: 'service' }).expect(
        201,
      )
    ).body.id as string;
    const none = await challan('other', '1', service);
    expect(
      (await post(`/quotes/${none.id}/dispatch`, {}).expect(400)).body.details,
    ).toMatchObject({ reason: 'no_stock_goods' });
    const many = await challan('exhibition', '50');
    expect(
      (await post(`/quotes/${many.id}/dispatch`, {}).expect(409)).body.details,
    ).toMatchObject({ reason: 'insufficient_stock' });
  });
});
