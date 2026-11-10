import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Batch = {
  id: string;
  batchNo: string;
  mfgDate: string | null;
  expiryDate: string | null;
  onHand: string;
  expired: boolean;
};
type InvoiceView = {
  id: string;
  number: string;
  lines: {
    id: string;
    batches: { batchNo: string; expiryDate: string | null; quantity: string }[];
  }[];
};

describe('Batches with expiry dates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let customer = '';
  let vendor = '';
  let pills = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const batches = async () =>
    (await get(`/items/${pills}/batches`).expect(200)).body as Batch[];
  const onHand = async () =>
    Object.fromEntries((await batches()).map((b) => [b.batchNo, b.onHand]));

  const bill = async (
    lines: {
      quantity: string;
      batchNo?: string;
      mfgDate?: string;
      expiryDate?: string;
    }[],
    date = '2026-05-01',
  ) => {
    const b = (
      await post('/bills', {
        contactId: vendor,
        billDate: date,
        lines: lines.map((l) => ({
          itemId: pills,
          description: 'Paracetamol 500mg',
          unitPrice: 10_00,
          accountId: acc.stock,
          ...l,
        })),
      }).expect(201)
    ).body as { id: string };
    return b.id;
  };
  const sale = async (quantity: string, issueDate: string, batchId?: string) =>
    (
      await post('/invoices', {
        contactId: customer,
        issueDate,
        lines: [
          {
            itemId: pills,
            description: 'Paracetamol 500mg',
            quantity,
            unitPrice: 20_00,
            accountId: acc.sales,
            ...(batchId ? { batchId } : {}),
          },
        ],
      }).expect(201)
    ).body as { id: string };

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
          name: `Batches ${run}`,
          slug: `batches-${run}`,
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
        name: 'City Chemist',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    vendor = (
      await post('/contacts', {
        name: 'Pharma Distributors',
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

  it('keeps batches only for goods whose stock is tracked', async () => {
    expect(
      (
        await post('/items', {
          name: 'Untracked',
          kind: 'goods',
          trackBatches: true,
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'batches_need_stock' });
    pills = (
      await post('/items', {
        name: 'Paracetamol 500mg',
        kind: 'goods',
        unit: 'TBS',
        trackStock: true,
        trackBatches: true,
        inventoryAccountId: acc.stock,
        cogsAccountId: acc.cogs,
      }).expect(201)
    ).body.id;
    expect((await get(`/items/${pills}`).expect(200)).body).toMatchObject({
      trackBatches: true,
    });
  });

  it('brings goods in by batch, with their dates, and needs the batch number', async () => {
    const missing = await bill([{ quantity: '10' }]);
    expect(
      (await post(`/bills/${missing}/record`).expect(400)).body.details,
    ).toMatchObject({ reason: 'batch_required' });
    await auth(http().delete(`/api/v1/bills/${missing}`)).expect(204);
    const b1 = await bill([
      {
        quantity: '10',
        batchNo: 'PX-LATE',
        mfgDate: '2026-01-01',
        expiryDate: '2027-12-31',
      },
      {
        quantity: '5',
        batchNo: 'PX-SOON',
        mfgDate: '2025-12-01',
        expiryDate: '2026-12-31',
      },
      { quantity: '4', batchNo: 'PX-OLD', expiryDate: '2026-06-30' },
    ]);
    await post(`/bills/${b1}/record`).expect(200);
    const view = (await get(`/bills/${b1}`).expect(200)).body as {
      lines: { batchNo: string; expiryDate: string }[];
    };
    expect(view.lines.map((l) => [l.batchNo, l.expiryDate])).toEqual([
      ['PX-LATE', '2027-12-31'],
      ['PX-SOON', '2026-12-31'],
      ['PX-OLD', '2026-06-30'],
    ]);
    expect(await onHand()).toEqual({
      'PX-OLD': '4',
      'PX-SOON': '5',
      'PX-LATE': '10',
    });
    // The same batch again with other dates is probably a different batch
    const clash = await bill([
      { quantity: '1', batchNo: 'px-soon', expiryDate: '2027-01-31' },
    ]);
    expect(
      (await post(`/bills/${clash}/record`).expect(409)).body.details,
    ).toMatchObject({ reason: 'batch_dates_differ' });
    await auth(http().delete(`/api/v1/bills/${clash}`)).expect(204);
  });

  it('sells the earliest-expiring batch first, skipping expired ones, and prints the batches', async () => {
    // On 10 Nov 2026 PX-OLD (June) has expired: 7 come from PX-SOON then PX-LATE
    const d = await sale('7', '2026-11-10');
    const inv = (await post(`/invoices/${d.id}/issue`).expect(200))
      .body as InvoiceView;
    const full = (await get(`/invoices/${inv.id}`).expect(200))
      .body as InvoiceView;
    expect(full.lines[0]!.batches).toEqual([
      {
        batchNo: 'PX-SOON',
        mfgDate: '2025-12-01',
        expiryDate: '2026-12-31',
        quantity: '5',
      },
      {
        batchNo: 'PX-LATE',
        mfgDate: '2026-01-01',
        expiryDate: '2027-12-31',
        quantity: '2',
      },
    ]);
    expect(await onHand()).toEqual({
      'PX-OLD': '4',
      'PX-SOON': '0',
      'PX-LATE': '8',
    });
    expect((await batches()).find((b) => b.batchNo === 'PX-OLD')!.expired).toBe(
      true,
    );
    // More than the unexpired stock can't be sold, even though 12 are on hand
    const tooMany = await sale('9', '2026-11-11');
    expect(
      (await post(`/invoices/${tooMany.id}/issue`).expect(409)).body.details,
    ).toMatchObject({ reason: 'insufficient_unexpired', onHand: '8' });
    // Nor from an expired batch chosen by hand
    const old = (await batches()).find((b) => b.batchNo === 'PX-OLD')!;
    const chosen = await sale('1', '2026-11-11', old.id);
    expect(
      (await post(`/invoices/${chosen.id}/issue`).expect(409)).body.details,
    ).toMatchObject({ reason: 'batch_expired' });
    // A batch chosen must be the item's
    expect(
      (
        await post('/invoices', {
          contactId: customer,
          issueDate: '2026-11-11',
          lines: [
            {
              description: 'Something else',
              quantity: '1',
              unitPrice: 100,
              accountId: acc.sales,
              batchId: old.id,
            },
          ],
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'batch_invalid' });
  });

  it('returns goods to the batches they left, and voiding puts them back', async () => {
    const list = (await get('/invoices?state=issued').expect(200)).body as {
      items: { id: string }[];
    };
    const inv = (await get(`/invoices/${list.items[0]!.id}`).expect(200))
      .body as InvoiceView;
    await post('/credit-notes', {
      invoiceId: inv.id,
      date: '2026-11-12',
      reason: 'Damaged strip',
      returnsStock: true,
      lines: [{ invoiceLineId: inv.lines[0]!.id, quantity: '6' }],
    }).expect(201);
    expect(await onHand()).toEqual({
      'PX-OLD': '4',
      'PX-SOON': '5',
      'PX-LATE': '9',
    });
  });

  it('writes off an expired batch, and adds found stock into a batch', async () => {
    await post('/inventory/adjustments', {
      itemId: pills,
      date: '2026-11-12',
      direction: 'out',
      quantity: '4',
      accountId: acc.writeoff,
      reason: 'Expired',
    }).expect(400);
    await post('/inventory/adjustments', {
      itemId: pills,
      date: '2026-11-12',
      direction: 'out',
      quantity: '5',
      accountId: acc.writeoff,
      reason: 'Expired',
      batchNo: 'PX-OLD',
    }).expect(409);
    const m = (
      await post('/inventory/adjustments', {
        itemId: pills,
        date: '2026-11-12',
        direction: 'out',
        quantity: '4',
        accountId: acc.writeoff,
        reason: 'Expired',
        batchNo: 'PX-OLD',
      }).expect(201)
    ).body as { id: string };
    await post('/inventory/adjustments', {
      itemId: pills,
      date: '2026-11-12',
      direction: 'in',
      quantity: '2',
      unitCost: 10_00,
      accountId: acc.writeoff,
      reason: 'Found in store',
      batchNo: 'PX-NEW',
      expiryDate: '2028-03-31',
    }).expect(201);
    expect(await onHand()).toEqual({
      'PX-OLD': '0',
      'PX-SOON': '5',
      'PX-LATE': '9',
      'PX-NEW': '2',
    });
    await auth(http().delete(`/api/v1/inventory/adjustments/${m.id}`)).expect(
      204,
    );
    expect((await onHand())['PX-OLD']).toBe('4');
  });

  it('won’t change to batches once stock has moved', async () => {
    expect(
      (await patch(`/items/${pills}`, { trackBatches: false }).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'stock_moved' });
  });
});
