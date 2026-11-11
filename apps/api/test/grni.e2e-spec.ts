import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Po = {
  id: string;
  grniValue: number;
  lines: { id: string; grni: { quantity: string; value: number } }[];
  receipts: { lines: { value: number; batchNo: string | null }[] }[];
};

/** Goods received on a purchase order come into stock then, owed until the bill is recorded */
describe('Goods received, not yet billed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let vendor = '';
  let cement = '';
  let paint = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const balance = async (accountId: string) => {
    const s = await prisma.journalLine.aggregate({
      where: { accountId, entry: { status: 'posted' } },
      _sum: { debit: true, credit: true },
    });
    return Number((s._sum.debit ?? 0n) - (s._sum.credit ?? 0n));
  };
  const grni = async () => {
    const a = await prisma.account.findFirst({
      where: { organizationId: org, systemKey: 'grni' },
      select: { id: true },
    });
    return a ? balance(a.id) : 0;
  };
  const stock = async (itemId: string) =>
    (
      (await get(`/inventory/items/${itemId}/movements`).expect(200)).body as {
        movements: { onHand: string; valueOnHand: number }[];
      }
    ).movements.at(-1)!;
  const order = async (itemId: string, quantity: string, unitPrice: number) => {
    const po = (
      await post('/purchase-orders', {
        contactId: vendor,
        orderDate: '2026-06-01',
        lines: [
          {
            itemId,
            description: 'Goods',
            quantity,
            unitPrice,
            accountId: acc.stock,
          },
        ],
      }).expect(201)
    ).body as Po;
    await post(`/purchase-orders/${po.id}/status`, {
      status: 'issued',
    }).expect(200);
    return po;
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
          name: `GRNI ${run}`,
          slug: `grni-${run}`,
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
      ['stock', { code: '1500', type: 'asset', subtype: 'inventory' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    vendor = (
      await post('/contacts', {
        name: 'UltraTech Dealers',
        isCustomer: false,
        isVendor: true,
      }).expect(201)
    ).body.id;
    const item = async (body: object) =>
      (
        await post('/items', {
          kind: 'goods',
          unit: 'BAG',
          trackStock: true,
          inventoryAccountId: acc.stock,
          cogsAccountId: acc.cogs,
          ...body,
        }).expect(201)
      ).body.id as string;
    cement = await item({ name: 'Cement' });
    paint = await item({ name: 'Paint', trackBatches: true });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('brings goods into stock on the receipt note, owed until the bill; the bill clears it and its price difference goes to stock', async () => {
    const po = await order(cement, '10', 400_00);
    const after = (
      await post(`/purchase-orders/${po.id}/receipts`, {
        date: '2026-06-05',
        lines: [{ lineId: po.lines[0]!.id, quantity: '6' }],
      }).expect(201)
    ).body as Po;
    expect(after.lines[0]!.grni).toEqual({ quantity: '6', value: 2_400_00 });
    expect(after.grniValue).toBe(2_400_00);
    expect(after.receipts[0]!.lines[0]!.value).toBe(2_400_00);
    expect(await stock(cement)).toMatchObject({
      onHand: '6',
      valueOnHand: 2_400_00,
    });
    expect(await balance(acc.stock)).toBe(2_400_00);
    expect(await grni()).toBe(-2_400_00);

    // The bill comes at ₹410 a bag: ₹60 more than the order
    const { billId } = (
      await post(`/purchase-orders/${po.id}/bill`).expect(201)
    ).body as { billId: string };
    const draft = (await get(`/bills/${billId}`).expect(200)).body as {
      billDate: string;
      lines: {
        description: string;
        quantity: string;
        item: { id: string } | null;
        account: { id: string } | null;
      }[];
    };
    await patch(`/bills/${billId}`, {
      contactId: vendor,
      billDate: draft.billDate,
      lines: draft.lines.map((l) => ({
        itemId: l.item?.id ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: 410_00,
        accountId: l.account?.id ?? null,
      })),
    }).expect(200);
    await post(`/bills/${billId}/record`).expect(200);
    // Not brought in twice: six bags, at what the bill said they cost
    expect(await stock(cement)).toMatchObject({
      onHand: '6',
      valueOnHand: 2_460_00,
    });
    expect(await balance(acc.stock)).toBe(2_460_00);
    expect(await grni()).toBe(0);
    expect(
      ((await get(`/purchase-orders/${po.id}`).expect(200)).body as Po)
        .grniValue,
    ).toBe(0);

    // Voided, the goods are owed again till another bill comes
    await post(`/bills/${billId}/void`, { date: '2026-06-30' }).expect(200);
    expect(await grni()).toBe(-2_400_00);
    expect(await stock(cement)).toMatchObject({
      onHand: '6',
      valueOnHand: 2_400_00,
    });
    expect(
      ((await get(`/purchase-orders/${po.id}`).expect(200)).body as Po)
        .lines[0]!.grni,
    ).toEqual({ quantity: '6', value: 2_400_00 });
  });

  it('takes the batch on the receipt note', async () => {
    const po = await order(paint, '5', 1_000_00);
    const after = (
      await post(`/purchase-orders/${po.id}/receipts`, {
        date: '2026-06-06',
        lines: [
          {
            lineId: po.lines[0]!.id,
            quantity: '5',
            batchNo: 'P-77',
            expiryDate: '2028-06-01',
          },
        ],
      }).expect(201)
    ).body as Po;
    expect(after.receipts[0]!.lines[0]!.batchNo).toBe('P-77');
    const batches = (await get(`/items/${paint}/batches`).expect(200)).body as {
      batchNo: string;
      onHand: string;
    }[];
    expect(batches.find((b) => b.batchNo === 'P-77')?.onHand).toBe('5');
  });
});
