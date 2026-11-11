import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
type Po = {
  id: string;
  number: string;
  status: string;
  total: number;
  lines: {
    id: string;
    quantity: string;
    received: string;
    billed: string;
    toReceive: string;
    toBill: string;
  }[];
  receipts: { number: string }[];
  bills: { id: string }[];
};

describe('Purchase orders and goods receipts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let vendor = '';

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
          name: `PO ${run}`,
          slug: `po-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
          addressLine1: 'Plot 4, Chakan MIDC',
          city: 'Pune',
          postalCode: '410501',
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
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst18 = groups.find((g) => g.name === 'GST 18%')!.id;
    await post('/accounts', {
      name: `creditors ${run}`,
      code: '2000',
      type: 'liability',
      subtype: 'accounts_payable',
    }).expect(201);
    const account = async (code: string, type: string, subtype: string) =>
      (
        await post('/accounts', {
          name: `${code} ${run}`,
          code,
          type,
          subtype,
        }).expect(201)
      ).body.id as string;
    expense = await account('5100', 'expense', 'operating_expense');
    vendor = (
      await post('/contacts', {
        name: 'Deccan Steel',
        isCustomer: false,
        isVendor: true,
        taxId: gstin('27AABFD1234K1Z'),
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

  const lines = () => [
    {
      description: 'Steel rods 12mm',
      quantity: '10',
      unitPrice: 500_00,
      taxGroupId: gst18,
      accountId: expense,
    },
    {
      description: 'Binding wire',
      quantity: '2',
      unitPrice: 150_00,
      taxGroupId: gst18,
      accountId: expense,
    },
  ];
  let po: Po;

  it('drafts an order priced like a bill, numbered PO-0001, and issues it', async () => {
    po = (
      await post('/purchase-orders', {
        contactId: vendor,
        orderDate: '2026-06-01',
        expectedDate: '2026-06-10',
        lines: lines(),
      }).expect(201)
    ).body as Po;
    expect(po).toMatchObject({
      number: 'PO-0001',
      status: 'draft',
      total: (5_000_00 + 300_00) * 1.18,
    });
    // Nothing comes against a draft
    expect(
      (
        await post(`/purchase-orders/${po.id}/receipts`, {
          date: '2026-06-05',
          lines: [{ lineId: po.lines[0]!.id, quantity: '1' }],
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'not_issued' });
    po = (
      await post(`/purchase-orders/${po.id}/status`, {
        status: 'issued',
      }).expect(200)
    ).body as Po;
    expect(po.status).toBe('issued');
  });

  it('receives goods on GRNs up to what was ordered, and bills what came', async () => {
    const [rods, wire] = po.lines;
    expect(
      (
        await post(`/purchase-orders/${po.id}/receipts`, {
          date: '2026-06-05',
          lines: [{ lineId: rods!.id, quantity: '11' }],
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'over_received', toReceive: '10' });
    po = (
      await post(`/purchase-orders/${po.id}/receipts`, {
        date: '2026-06-05',
        reference: 'DC-881',
        lines: [
          { lineId: rods!.id, quantity: '4' },
          { lineId: wire!.id, quantity: '2' },
        ],
      }).expect(201)
    ).body as Po;
    expect(po.receipts.map((r) => r.number)).toEqual(['GRN-0001']);
    expect(po.lines.map((l) => [l.received, l.toReceive, l.toBill])).toEqual([
      ['4', '6', '4'],
      ['2', '0', '2'],
    ]);
    // Can't cancel once goods came
    await post(`/purchase-orders/${po.id}/status`, {
      status: 'cancelled',
    }).expect(409);
    const first = (await post(`/purchase-orders/${po.id}/bill`).expect(201))
      .body as { purchaseOrder: Po; billId: string };
    const bill = (await get(`/bills/${first.billId}`).expect(200)).body as {
      status: string;
      lines: { quantity: string; amount: number }[];
    };
    expect(bill.status).toBe('draft');
    expect(bill.lines.map((l) => [l.quantity, l.amount])).toEqual([
      ['4', 2_000_00],
      ['2', 300_00],
    ]);
    expect(first.purchaseOrder.status).toBe('issued');
    expect(
      (await post(`/purchase-orders/${po.id}/bill`).expect(409)).body.details,
    ).toMatchObject({ reason: 'nothing_to_bill' });
    // The rest comes, is billed, and the order closes
    await post(`/purchase-orders/${po.id}/receipts`, {
      date: '2026-06-09',
      lines: [{ lineId: rods!.id, quantity: '6' }],
    }).expect(201);
    const second = (await post(`/purchase-orders/${po.id}/bill`).expect(201))
      .body as { purchaseOrder: Po };
    expect(second.purchaseOrder.status).toBe('closed');
    expect(second.purchaseOrder.bills).toHaveLength(2);
  });

  it('lists open orders, and deletes only drafts', async () => {
    const draft = (
      await post('/purchase-orders', {
        contactId: vendor,
        orderDate: '2026-06-02',
        lines: lines(),
      }).expect(201)
    ).body as Po;
    const open = (await get('/purchase-orders?status=open').expect(200))
      .body as { items: Po[] };
    expect(open.items.map((x) => x.number)).toEqual([draft.number]);
    await auth(http().delete(`/api/v1/purchase-orders/${po.id}`)).expect(409);
    await auth(http().delete(`/api/v1/purchase-orders/${draft.id}`)).expect(
      204,
    );
  });
});
