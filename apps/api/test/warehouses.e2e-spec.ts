import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Wh = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  archived: boolean;
  items: number;
  value: number;
};

/** Stock kept in more than one place: quantities and cost per warehouse, and goods moved between them */
describe('Warehouses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let customer = '';
  let vendor = '';
  let oil = '';
  let syrup = '';
  let main: Wh;
  let pune: Wh;

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const list = async () =>
    ((await get('/warehouses').expect(200)).body as { warehouses: Wh[] })
      .warehouses;
  const stockIn = async (w: Wh) =>
    (
      (await get(`/warehouses/${w.id}/stock`).expect(200)).body as {
        items: { name: string; quantity: string; value: number }[];
      }
    ).items;
  const bill = async (itemId: string, quantity: number, extra: object = {}) => {
    const id = (
      await post('/bills', {
        contactId: vendor,
        billDate: '2026-06-01',
        lines: [
          {
            itemId,
            description: 'Goods',
            quantity,
            unitPrice: 100_00,
            accountId: acc.stock,
            ...extra,
          },
        ],
      }).expect(201)
    ).body.id as string;
    await post(`/bills/${id}/record`).expect(200);
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
          name: `Warehouses ${run}`,
          slug: `warehouses-${run}`,
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
      ['loss', { code: '5200', type: 'expense', subtype: 'operating_expense' }],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await post('/contacts', {
        name: 'Joshi Kirana',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    vendor = (
      await post('/contacts', {
        name: 'Fortune Distributors',
        isCustomer: false,
        isVendor: true,
      }).expect(201)
    ).body.id;
    const item = async (body: object) =>
      (
        await post('/items', {
          kind: 'goods',
          unit: 'LTR',
          trackStock: true,
          inventoryAccountId: acc.stock,
          cogsAccountId: acc.cogs,
          ...body,
        }).expect(201)
      ).body.id as string;
    oil = await item({ name: 'Groundnut oil' });
    syrup = await item({ name: 'Cough syrup', trackBatches: true });
    // Before any warehouse: stock is just stock
    await bill(oil, 10);
    await bill(syrup, 5, { batchNo: 'CS-1', expiryDate: '2028-01-31' });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('brings a main warehouse with the first one, holding the stock there was', async () => {
    expect(await list()).toEqual([]);
    pune = (
      await post('/warehouses', {
        name: 'Pune shop',
        address: { city: 'Pune', region: 'Maharashtra' },
      }).expect(201)
    ).body as Wh;
    expect(pune).toMatchObject({ code: 'PUNE', isDefault: false, items: 0 });
    const all = await list();
    main = all.find((w) => w.isDefault)!;
    expect(main).toMatchObject({
      name: 'Main warehouse',
      code: 'MAIN',
      items: 2,
      value: 1_500_00,
    });
    // Names and codes once each
    expect(
      (await post('/warehouses', { name: 'pune SHOP' }).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'name_taken' });
  });

  it('moves goods between warehouses at their cost, batches and all, with no entry', async () => {
    const t = (
      await post('/inventory/transfers', {
        date: '2026-06-05',
        fromWarehouseId: main.id,
        toWarehouseId: pune.id,
        reference: 'LR 4471',
        lines: [
          { itemId: oil, quantity: '4' },
          { itemId: syrup, quantity: '2' },
        ],
      }).expect(201)
    ).body as { number: string; value: number; lines: unknown[] };
    expect(t).toMatchObject({ number: 'TR-0001', value: 600_00 });
    expect(await stockIn(pune)).toEqual([
      {
        itemId: syrup,
        name: 'Cough syrup',
        unit: 'LTR',
        quantity: '2',
        value: 200_00,
      },
      {
        itemId: oil,
        name: 'Groundnut oil',
        unit: 'LTR',
        quantity: '4',
        value: 400_00,
      },
    ]);
    expect((await stockIn(main)).map((i) => i.quantity)).toEqual(['3', '6']);
    // The batch moved with it
    const batches = await prisma.stockMovement.findMany({
      where: { organizationId: org, kind: 'transfer', itemId: syrup },
      select: { batch: { select: { batchNo: true } }, warehouseId: true },
    });
    expect(batches.map((b) => b.batch?.batchNo)).toEqual(['CS-1', 'CS-1']);
    // Not more than is there
    expect(
      (
        await post('/inventory/transfers', {
          date: '2026-06-05',
          fromWarehouseId: pune.id,
          toWarehouseId: main.id,
          lines: [{ itemId: oil, quantity: '5' }],
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'insufficient_stock' });
  });

  it('sells and writes off from one warehouse, counting only what’s there', async () => {
    // An invoice takes from the main warehouse: six there, though ten in all
    const inv = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-06-10',
        lines: [
          {
            itemId: oil,
            description: 'Groundnut oil',
            quantity: 7,
            unitPrice: 150_00,
            accountId: acc.sales,
          },
        ],
      }).expect(201)
    ).body.id as string;
    expect(
      (await post(`/invoices/${inv}/issue`).expect(409)).body.details,
    ).toMatchObject({ reason: 'insufficient_stock', onHand: '6' });
    await post('/inventory/adjustments', {
      itemId: oil,
      date: '2026-06-11',
      direction: 'out',
      quantity: '1',
      accountId: acc.loss,
      reason: 'Tin leaked',
      warehouseId: pune.id,
    }).expect(201);
    expect(
      (await stockIn(pune)).find((i) => i.name === 'Groundnut oil'),
    ).toMatchObject({ quantity: '3', value: 300_00 });
  });

  it('archives a warehouse only once it’s empty, and never the main one', async () => {
    expect(
      (await post(`/warehouses/${pune.id}/archive`).expect(409)).body.details,
    ).toMatchObject({ reason: 'warehouse_has_stock' });
    expect(
      (await post(`/warehouses/${main.id}/archive`).expect(409)).body.details,
    ).toMatchObject({ reason: 'warehouse_default' });
    await post('/inventory/transfers', {
      date: '2026-06-12',
      fromWarehouseId: pune.id,
      toWarehouseId: main.id,
      lines: [
        { itemId: oil, quantity: '3' },
        { itemId: syrup, quantity: '2' },
      ],
    }).expect(201);
    await post(`/warehouses/${pune.id}/archive`).expect(204);
    expect((await list()).find((w) => w.id === pune.id)?.archived).toBe(true);
    // Another can become the main one
    const bhiwandi = (
      await post('/warehouses', { name: 'Bhiwandi godown' }).expect(201)
    ).body as Wh;
    await patch(`/warehouses/${bhiwandi.id}`, { isDefault: true }).expect(200);
    expect(
      (await list()).filter((w) => w.isDefault).map((w) => w.code),
    ).toEqual(['BHIW']);
    // Stock movements say where
    const moves = (
      (await get(`/inventory/items/${oil}/movements`).expect(200)).body as {
        movements: {
          kind: string;
          warehouse: { name: string } | null;
          document: { number: string } | null;
        }[];
      }
    ).movements;
    expect(
      moves
        .filter((m) => m.kind === 'transfer')
        .map((m) => [m.warehouse?.name, m.document?.number]),
    ).toEqual([
      // Each transfer: in, then out (what came in first)
      ['Pune shop', 'TR-0001'],
      ['Main warehouse', 'TR-0001'],
      ['Main warehouse', 'TR-0002'],
      ['Pune shop', 'TR-0002'],
    ]);
  });

  it('lets each document say which warehouse its goods leave or come into', async () => {
    const nashik = (
      await post('/warehouses', { name: 'Nashik depot' }).expect(201)
    ).body as Wh;
    // A bill brings five tins into Nashik
    const b = (
      await post('/bills', {
        contactId: vendor,
        billDate: '2026-06-15',
        warehouseId: nashik.id,
        lines: [
          {
            itemId: oil,
            description: 'Groundnut oil',
            quantity: 5,
            unitPrice: 100_00,
            accountId: acc.stock,
          },
        ],
      }).expect(201)
    ).body as { id: string; warehouse: { name: string } | null };
    expect(b.warehouse?.name).toBe('Nashik depot');
    await post(`/bills/${b.id}/record`).expect(200);
    expect((await stockIn(nashik)).map((i) => i.quantity)).toEqual(['5']);
    // Sold from Nashik: only what's there
    const sell = async (quantity: number, warehouseId?: string) => {
      const id = (
        await post('/invoices', {
          contactId: customer,
          issueDate: '2026-06-16',
          ...(warehouseId ? { warehouseId } : {}),
          lines: [
            {
              itemId: oil,
              description: 'Groundnut oil',
              quantity,
              unitPrice: 150_00,
              accountId: acc.sales,
            },
          ],
        }).expect(201)
      ).body.id as string;
      return post(`/invoices/${id}/issue`);
    };
    expect((await sell(3, nashik.id)).status).toBe(200);
    expect(
      ((await sell(3, nashik.id)).body as { details: object }).details,
    ).toMatchObject({ reason: 'insufficient_stock', onHand: '2' });
    // With none said, the main warehouse (Bhiwandi now, empty)
    expect(((await sell(1)).body as { details: object }).details).toMatchObject(
      { reason: 'insufficient_stock', onHand: '0' },
    );
    // A challan sends goods from the warehouse it names
    const dc = (
      await post('/quotes', {
        contactId: customer,
        kind: 'delivery_challan',
        purpose: 'approval',
        quoteDate: '2026-06-17',
        expiryDate: '2026-06-17',
        warehouseId: main.id,
        lines: [
          {
            itemId: oil,
            description: 'Groundnut oil',
            quantity: '2',
            unitPrice: 150_00,
            accountId: acc.sales,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/quotes/${dc.id}/dispatch`, { date: '2026-06-17' }).expect(200);
    expect(
      (await stockIn(main)).find((i) => i.name === 'Groundnut oil')?.quantity,
    ).toBe('7');
    // Only a warehouse in use
    expect(
      (
        await post('/invoices', {
          contactId: customer,
          issueDate: '2026-06-16',
          warehouseId: pune.id,
          lines: [
            {
              description: 'x',
              quantity: 1,
              unitPrice: 1_00,
              accountId: acc.sales,
            },
          ],
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'warehouse_invalid' });
  });
});
