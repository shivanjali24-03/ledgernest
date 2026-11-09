import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Aging = {
  baseCurrency: string;
  contacts: {
    contact: { name: string };
    currency: string | null;
    buckets: Record<string, number>;
    total: number;
    advance: number;
    baseTotal: number;
    documents: {
      number: string;
      bucket: string;
      daysOverdue: number;
      outstanding: number;
    }[];
  }[];
  totals: {
    buckets: Record<string, number>;
    total: number;
    advance: number;
    net: number;
  };
};

describe('Aging reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let org = '';

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
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
    };
  };
  const issue = async (
    contactId: string,
    issueDate: string,
    dueDate: string,
    unitPrice: number,
  ) => {
    const d = (
      await as()
        .post('/invoices', {
          contactId,
          issueDate,
          dueDate,
          lines: [
            {
              description: 'Services',
              quantity: 1,
              unitPrice,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body;
    return (await as().post(`/invoices/${d.id}/issue`).expect(200)).body
      .id as string;
  };
  const aging = async (side: string, asOf: string, who = 'owner') =>
    (await as(who).get(`/reports/aging?side=${side}&asOf=${asOf}`).expect(200))
      .body as Aging;
  const receive = (
    contactId: string,
    date: string,
    amount: number,
    allocations: object[] = [],
  ) =>
    as()
      .post('/payments/receipts', {
        contactId,
        date,
        bankAccountId: acc.bank,
        amount,
        allocations,
      })
      .expect(201);

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
          name: `Aging ${run}`,
          slug: `aging-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
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
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await as()
      .put('/currencies/USD/rates/2026-04-01', { rate: '90' })
      .expect(200);
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'usdDebtors',
        {
          code: '1250',
          type: 'asset',
          subtype: 'accounts_receivable',
          currency: 'USD',
        },
      ],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    contact.northwind = (
      await as()
        .post('/contacts', {
          name: 'Northwind Inc.',
          isCustomer: true,
          isVendor: false,
          currency: 'USD',
        })
        .expect(201)
    ).body.id;
    contact.sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Supplies',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
    inv.a = await issue(contact.kumar, '2026-04-10', '2026-04-20', 100_000);
    inv.d = await issue(contact.kumar, '2026-05-01', '2026-05-01', 20_000);
    inv.b = await issue(contact.kumar, '2026-06-01', '2026-06-15', 50_000);
    inv.c = await issue(contact.kumar, '2026-06-20', '2026-07-20', 30_000);
    inv.n = await issue(contact.northwind, '2026-05-10', '2026-05-15', 50_000);
    await receive(contact.kumar, '2026-06-25', 40_000, [
      { invoiceId: inv.a, amount: 40_000 },
    ]);
    await receive(contact.kumar, '2026-06-28', 5_000);
    await receive(contact.kumar, '2026-07-05', 50_000, [
      { invoiceId: inv.b, amount: 50_000 },
    ]);
    await as()
      .post(`/invoices/${inv.d}/void`, {
        date: '2026-07-01',
        reason: 'Raised twice',
      })
      .expect(200);
    const bill = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          billDate: '2026-04-01',
          dueDate: '2026-04-01',
          lines: [
            {
              description: 'Rent',
              quantity: 1,
              unitPrice: 25_000,
              accountId: acc.rent,
            },
          ],
        })
        .expect(201)
    ).body;
    await as().post(`/bills/${bill.id}/record`).expect(200);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('ages receivables by days past due, per customer and currency, less what was paid by then', async () => {
    const a = await aging('receivables', '2026-06-30');
    expect(a.contacts.map((c) => [c.contact.name, c.currency])).toEqual([
      ['Kumar Logistics', null],
      ['Northwind Inc.', 'USD'],
    ]);
    const [kumar, northwind] = a.contacts;
    // A: 1,000 less 400 paid, 71 days late. D: 60 days (voided only on 1 July). B: 15 days. C: not due yet.
    expect(kumar!.buckets).toEqual({
      current: 30_000,
      d1_30: 50_000,
      d31_60: 20_000,
      d61_90: 60_000,
      over_90: 0,
    });
    expect(kumar!).toMatchObject({ total: 160_000, advance: 5_000 });
    expect(
      kumar!.documents.map((d) => [d.bucket, d.daysOverdue, d.outstanding]),
    ).toEqual([
      ['d61_90', 71, 60_000],
      ['d31_60', 60, 20_000],
      ['d1_30', 15, 50_000],
      ['current', 0, 30_000],
    ]);
    // USD 500 at 90, 46 days late
    expect(northwind!).toMatchObject({ total: 50_000, baseTotal: 4_500_000 });
    expect(northwind!.buckets.d31_60).toBe(50_000);
    expect(a.totals).toEqual({
      buckets: {
        current: 30_000,
        d1_30: 50_000,
        d31_60: 4_520_000,
        d61_90: 60_000,
        over_90: 0,
      },
      total: 4_660_000,
      advance: 5_000,
      net: 4_655_000,
    });
  });

  it('a later day sees the later payment and the void, and the oldest debt moves on', async () => {
    const kumar = (await aging('receivables', '2026-07-21')).contacts.find(
      (c) => c.contact.name === 'Kumar Logistics',
    )!;
    expect(kumar.buckets).toEqual({
      current: 0,
      d1_30: 30_000,
      d31_60: 0,
      d61_90: 0,
      over_90: 60_000,
    });
    expect(kumar.documents).toHaveLength(2);
    // Before anything was issued, nobody owes anything
    expect((await aging('receivables', '2026-04-01')).contacts).toEqual([]);
  });

  it('ages payables the same way', async () => {
    const a = await aging('payables', '2026-07-15');
    expect(a.contacts).toHaveLength(1);
    expect(a.contacts[0]!).toMatchObject({
      contact: { name: 'Sharma Supplies' },
      total: 25_000,
    });
    expect(a.contacts[0]!.documents[0]!).toMatchObject({
      number: 'BILL/2026-27/0001',
      bucket: 'over_90',
      daysOverdue: 105,
    });
  });

  it('exports CSV, and needs report permissions', async () => {
    const r = await as()
      .get('/reports/aging/export?side=receivables&asOf=2026-06-30')
      .expect(200);
    expect(r.headers['content-disposition']).toContain(
      'receivables-aging-2026-06-30.csv',
    );
    const lines = r.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines[0]).toBe(
      'contact,document,date,due_date,days_overdue,currency,current,1_30,31_60,61_90,over_90,advance,net',
    );
    expect(lines[1]).toBe(
      'Kumar Logistics,INV/2026-27/0001,2026-04-10,2026-04-20,71,INR,,,,600.00,,,600.00',
    );
    expect(lines).toContain(
      'Kumar Logistics total,,,,,INR,300.00,500.00,200.00,600.00,0.00,50.00,1550.00',
    );
    expect(lines.at(-1)).toBe(
      'Total (INR),,,,,INR,300.00,500.00,45200.00,600.00,0.00,50.00,46550.00',
    );
    await as('viewer').get('/reports/aging?side=receivables').expect(200);
    await as().get('/reports/aging?side=sideways').expect(400);
  });
});
