import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type History = {
  item: string;
  serialNo: string;
  status: string;
  movements: {
    kind: string;
    document: { number: string | null } | null;
    contact: string | null;
  }[];
}[];

describe('Serial numbers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let customer = '';
  let vendor = '';
  let phone = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const status = async (serial: string) =>
    ((await get(`/inventory/serials/${serial}`).expect(200)).body as History)[0]
      ?.status;
  const draftBill = async (quantity: string, serials: string[]) =>
    (
      await post('/bills', {
        contactId: vendor,
        billDate: '2026-06-01',
        lines: [
          {
            itemId: phone,
            description: 'Phone X',
            quantity,
            unitPrice: 10_000_00,
            accountId: acc.stock,
            serials,
          },
        ],
      }).expect(201)
    ).body.id as string;
  const draftInvoice = async (quantity: string, serials: string[]) =>
    (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-06-10',
        lines: [
          {
            itemId: phone,
            description: 'Phone X',
            quantity,
            unitPrice: 15_000_00,
            accountId: acc.sales,
            serials,
          },
        ],
      }).expect(201)
    ).body.id as string;

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
          name: `Serials ${run}`,
          slug: `serials-${run}`,
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
      [
        'writeoff',
        { code: '5100', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await post('/contacts', {
        name: 'Ravi Mobiles',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    vendor = (
      await post('/contacts', {
        name: 'Phone Distributors',
        isCustomer: false,
        isVendor: true,
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

  it('keeps serial numbers only for tracked goods, and not with batches', async () => {
    expect(
      (
        await post('/items', {
          name: 'Loose',
          kind: 'goods',
          trackSerials: true,
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'serials_need_stock' });
    expect(
      (
        await post('/items', {
          name: 'Both',
          kind: 'goods',
          trackStock: true,
          trackBatches: true,
          trackSerials: true,
          inventoryAccountId: acc.stock,
          cogsAccountId: acc.cogs,
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'batches_or_serials' });
    phone = (
      await post('/items', {
        name: 'Phone X',
        kind: 'goods',
        unit: 'NOS',
        trackStock: true,
        trackSerials: true,
        inventoryAccountId: acc.stock,
        cogsAccountId: acc.cogs,
      }).expect(201)
    ).body.id;
  });

  it('records each unit bought, one serial per unit', async () => {
    for (const [quantity, serials, reason] of [
      ['3', ['IMEI-A', 'IMEI-B'], 'serials_count'],
      ['1.5', ['IMEI-A'], 'serials_not_whole'],
      ['2', ['IMEI-A', 'imei-a'], 'serials_duplicate'],
    ] as const) {
      const b = await draftBill(quantity, [...serials]);
      expect(
        (await post(`/bills/${b}/record`).expect(400)).body.details,
      ).toMatchObject({ reason });
      await auth(http().delete(`/api/v1/bills/${b}`)).expect(204);
    }
    const b = await draftBill('3', ['imei-a', 'IMEI-B', 'IMEI-C']);
    await post(`/bills/${b}/record`).expect(200);
    expect(
      (await get(`/bills/${b}`).expect(200)).body.lines[0].serials,
    ).toEqual(['IMEI-A', 'IMEI-B', 'IMEI-C']);
    expect(await status('imei-a')).toBe('in_stock');
    // The same unit can't come in twice
    const again = await draftBill('1', ['IMEI-B']);
    expect(
      (await post(`/bills/${again}/record`).expect(409)).body.details,
    ).toMatchObject({ reason: 'serial_in_stock', serial: 'IMEI-B' });
    await auth(http().delete(`/api/v1/bills/${again}`)).expect(204);
  });

  it('sells the units named, prints them, and refuses units not in stock', async () => {
    const unknown = await draftInvoice('1', ['IMEI-Z']);
    expect(
      (await post(`/invoices/${unknown}/issue`).expect(409)).body.details,
    ).toMatchObject({ reason: 'serial_not_in_stock', serial: 'IMEI-Z' });
    await auth(http().delete(`/api/v1/invoices/${unknown}`)).expect(204);
    const d = await draftInvoice('2', ['IMEI-A', 'IMEI-B']);
    const inv = (await post(`/invoices/${d}/issue`).expect(200)).body as {
      id: string;
      number: string;
      lines: { id: string; serials: string[] }[];
    };
    expect(inv.lines[0]!.serials).toEqual(['IMEI-A', 'IMEI-B']);
    expect(await status('IMEI-A')).toBe('sold');
    // Sold units can't be sold again
    const twice = await draftInvoice('1', ['IMEI-A']);
    expect(
      (await post(`/invoices/${twice}/issue`).expect(409)).body.details,
    ).toMatchObject({ reason: 'serial_not_in_stock' });
    await auth(http().delete(`/api/v1/invoices/${twice}`)).expect(204);
    // A return names the units coming back, which must be ones sold on the line
    expect(
      (
        await post('/credit-notes', {
          invoiceId: inv.id,
          date: '2026-06-12',
          reason: 'Faulty',
          returnsStock: true,
          lines: [
            {
              invoiceLineId: inv.lines[0]!.id,
              quantity: '1',
              serials: ['IMEI-C'],
            },
          ],
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'serial_not_sold', serial: 'IMEI-C' });
    await post('/credit-notes', {
      invoiceId: inv.id,
      date: '2026-06-12',
      reason: 'Faulty',
      returnsStock: true,
      lines: [
        { invoiceLineId: inv.lines[0]!.id, quantity: '1', serials: ['IMEI-B'] },
      ],
    }).expect(201);
    expect(await status('IMEI-B')).toBe('in_stock');
  });

  it('tells a unit’s story: bought from whom, sold to whom, returned', async () => {
    const h = (await get('/inventory/serials/imei-b').expect(200))
      .body as History;
    expect(h).toEqual([
      expect.objectContaining({
        item: 'Phone X',
        serialNo: 'IMEI-B',
        status: 'in_stock',
        movements: [
          expect.objectContaining({
            kind: 'bill',
            contact: 'Phone Distributors',
          }),
          expect.objectContaining({ kind: 'invoice', contact: 'Ravi Mobiles' }),
          expect.objectContaining({
            kind: 'credit_note',
            contact: 'Ravi Mobiles',
          }),
        ],
      }),
    ]);
    expect((await get('/inventory/serials/NOPE-123').expect(200)).body).toEqual(
      [],
    );
    await get('/inventory/serials/a%20b').expect(400);
  });

  it('writes off a unit by its serial and undoes it; voiding the invoice puts its units back', async () => {
    const m = (
      await post('/inventory/adjustments', {
        itemId: phone,
        date: '2026-06-15',
        direction: 'out',
        quantity: '1',
        accountId: acc.writeoff,
        reason: 'Stolen',
        serials: ['IMEI-C'],
      }).expect(201)
    ).body as { id: string };
    expect(await status('IMEI-C')).toBe('written_off');
    await auth(http().delete(`/api/v1/inventory/adjustments/${m.id}`)).expect(
      204,
    );
    expect(await status('IMEI-C')).toBe('in_stock');
    // A fresh sale of IMEI-C, then voided
    const d = await draftInvoice('1', ['IMEI-C']);
    const inv = (await post(`/invoices/${d}/issue`).expect(200)).body as {
      id: string;
    };
    expect(await status('IMEI-C')).toBe('sold');
    await post(`/invoices/${inv.id}/void`, {}).expect(200);
    expect(await status('IMEI-C')).toBe('in_stock');
  });
});
