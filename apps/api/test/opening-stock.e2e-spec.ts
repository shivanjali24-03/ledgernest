import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Item = {
  id: string;
  altUnit: string | null;
  altFactor: string | null;
  stock: { onHand: string; value: number } | null;
};

describe('Opening stock and second units (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let customer = '';
  let vendor = '';
  let soap = '';
  let pills = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const item = async (id: string) =>
    (await get(`/items/${id}`).expect(200)).body as Item;

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
          name: `Opening ${run}`,
          slug: `opening-${run}`,
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
        name: 'Gupta Stores',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    vendor = (
      await post('/contacts', {
        name: 'FMCG Distributors',
        isCustomer: false,
        isVendor: true,
      }).expect(201)
    ).body.id;
    const stocked = {
      kind: 'goods',
      trackStock: true,
      inventoryAccountId: acc.stock,
      cogsAccountId: acc.cogs,
    };
    soap = (
      await post('/items', {
        name: 'Bath soap',
        unit: 'PCS',
        altUnit: 'BOX',
        altFactor: '12',
        ...stocked,
      }).expect(201)
    ).body.id;
    pills = (
      await post('/items', {
        name: 'Antacid',
        unit: 'TBS',
        trackBatches: true,
        ...stocked,
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

  it('keeps an item’s second unit only with how many make one', async () => {
    expect(await item(soap)).toMatchObject({ altUnit: 'BOX', altFactor: '12' });
    await post('/items', {
      name: 'Half',
      kind: 'goods',
      altUnit: 'BOX',
    }).expect(400);
  });

  it('enters opening stock for many items at once, against Opening balance equity, all or nothing', async () => {
    // A batched item without its batch: nothing is saved
    await post('/inventory/opening-stock', {
      date: '2026-04-01',
      lines: [
        { itemId: soap, quantity: '100', unitCost: 20_00 },
        { itemId: pills, quantity: '50', unitCost: 2_00 },
      ],
    }).expect(400);
    expect((await item(soap)).stock).toMatchObject({ onHand: '0' });
    const r = (
      await post('/inventory/opening-stock', {
        date: '2026-04-01',
        lines: [
          { itemId: soap, quantity: '100', unitCost: 20_00 },
          {
            itemId: pills,
            quantity: '50',
            unitCost: 2_00,
            batchNo: 'AC-1',
            expiryDate: '2027-03-31',
          },
        ],
      }).expect(201)
    ).body as { movements: { kind: string; reason: string; value: number }[] };
    expect(r.movements.map((m) => [m.kind, m.reason, m.value])).toEqual([
      ['adjustment', 'Opening stock', 2_000_00],
      ['adjustment', 'Opening stock', 100_00],
    ]);
    expect((await item(soap)).stock).toMatchObject({
      onHand: '100',
      value: 2_000_00,
    });
    const equity = await prisma.account.findFirstOrThrow({
      where: { organizationId: org, systemKey: 'opening_balance_equity' },
      select: { id: true },
    });
    const credited = await prisma.journalLine.aggregate({
      where: { organizationId: org, accountId: equity.id },
      _sum: { credit: true },
    });
    expect(Number(credited._sum.credit)).toBe(2_100_00);
  });

  it('sells, buys and takes back in the second unit, keeping stock in the main one', async () => {
    const d = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-05-01',
        lines: [
          {
            itemId: soap,
            description: 'Bath soap (box of 12)',
            quantity: '2',
            unitPrice: 300_00,
            inAltUnit: true,
            accountId: acc.sales,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    const inv = (await post(`/invoices/${d.id}/issue`).expect(200)).body as {
      id: string;
      lines: {
        id: string;
        quantity: string;
        inAltUnit: boolean;
        item: { unit: string };
      }[];
    };
    expect(inv.lines[0]).toMatchObject({
      quantity: '2',
      inAltUnit: true,
      item: { unit: 'BOX' },
    });
    expect((await item(soap)).stock).toMatchObject({
      onHand: '76',
      value: 1_520_00,
    });
    await post('/credit-notes', {
      invoiceId: inv.id,
      date: '2026-05-02',
      reason: 'One box damaged in transit',
      returnsStock: true,
      lines: [{ invoiceLineId: inv.lines[0]!.id, quantity: '1' }],
    }).expect(201);
    expect((await item(soap)).stock).toMatchObject({ onHand: '88' });
    const b = (
      await post('/bills', {
        contactId: vendor,
        billDate: '2026-05-03',
        lines: [
          {
            itemId: soap,
            description: 'Bath soap',
            quantity: '1',
            unitPrice: 240_00,
            inAltUnit: true,
            accountId: acc.stock,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/bills/${b.id}/record`).expect(200);
    expect((await item(soap)).stock).toMatchObject({ onHand: '100' });
  });
});
