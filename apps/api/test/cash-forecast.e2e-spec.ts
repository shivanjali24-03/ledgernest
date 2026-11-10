import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { addDays, todayIn } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Forecast = {
  today: string;
  opening: number;
  currency: string;
  weeks: {
    start: string;
    inflow: number;
    outflow: number;
    closing: number;
    items: {
      kind: string;
      label: string;
      expected: string;
      amount: number;
      lateDays?: number;
    }[];
  }[];
  lowest: { start: string; balance: number };
  shortfall: { start: string; balance: number } | null;
  overdue: { inflow: number; outflow: number };
  lateCustomers: { contact: { name: string }; days: number }[];
};

describe('Cash forecast (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';
  // Everything is dated from today, so the test means the same whenever it runs
  const today = todayIn('Asia/Kolkata');
  const day = (n: number) => addDays(today, n);
  const fyStart = (d: string) =>
    Number(d.slice(5, 7)) >= 4
      ? Number(d.slice(0, 4))
      : Number(d.slice(0, 4)) - 1;

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };
  const invoice = async (
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
              description: 'Freight',
              quantity: 1,
              unitPrice,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/invoices/${d.id}/issue`).expect(200);
    return d.id;
  };
  const receive = (invoiceId: string, date: string, amount: number) =>
    as()
      .post('/payments/receipts', {
        contactId: contact.kumar,
        date,
        bankAccountId: acc.bank,
        amount,
        allocations: [{ invoiceId, amount }],
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
          name: `Forecast ${run}`,
          slug: `forecast-${run}`,
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
          name: key,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    // This financial year and the one before, for the history
    for (const y of new Set([
      fyStart(day(-90)),
      fyStart(today),
      fyStart(day(60)),
    ]))
      await as().post('/fiscal-years', { startYear: y }).expect(201);
    for (const [key, body] of [
      ['kumar', { name: 'Kumar Logistics', isCustomer: true, isVendor: false }],
      [
        'bluewave',
        { name: 'Bluewave Clinics', isCustomer: true, isVendor: false },
      ],
      [
        'landlord',
        {
          name: 'Baner Estates',
          isCustomer: false,
          isVendor: true,
          paymentTermsDays: 7,
        },
      ],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
    // Kumar has paid two invoices, each 10 days late: ₹20,000 is in the bank
    await receive(
      await invoice(contact.kumar, day(-90), day(-60), 10_000_00),
      day(-50),
      10_000_00,
    );
    await receive(
      await invoice(contact.kumar, day(-70), day(-40), 10_000_00),
      day(-30),
      10_000_00,
    );
    // Open: Kumar's due in 3 days (so expected in 13), and Bluewave's, overdue
    await invoice(contact.kumar, day(-27), day(3), 30_000_00);
    await invoice(contact.bluewave, day(-35), day(-5), 5_000_00);
    // Rent due tomorrow
    const rent = (
      await as()
        .post('/bills', {
          contactId: contact.landlord,
          vendorReference: 'RENT-NOW',
          billDate: day(-6),
          dueDate: day(1),
          lines: [
            {
              description: 'Rent',
              quantity: 1,
              unitPrice: 50_000_00,
              accountId: acc.rent,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/bills/${rent.id}/record`).expect(200);
    // A repeat bill raised in two weeks, due a week later on the landlord's terms
    await as()
      .post('/recurring-bills', {
        name: 'Parking',
        contactId: contact.landlord,
        frequency: 'monthly',
        startDate: day(14),
        maxCount: 1,
        lines: [
          {
            description: 'Parking',
            quantity: '1',
            unitPrice: 10_000_00,
            accountId: acc.rent,
          },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('forecasts cash week by week, expecting each customer to pay as late as they usually do', async () => {
    const f = (
      await as('viewer').get('/reports/cash-forecast?weeks=6').expect(200)
    ).body as Forecast;
    expect(f).toMatchObject({ today, opening: 20_000_00, currency: 'INR' });
    expect(f.weeks).toHaveLength(6);
    const flows = f.weeks.map((w) => [w.inflow, w.outflow, w.closing]);
    expect(flows).toEqual([
      // Bluewave's overdue ₹5,000 now; rent ₹50,000 tomorrow
      [5_000_00, 50_000_00, -25_000_00],
      // Kumar's ₹30,000, due in 3 days, 10 days late as usual
      [30_000_00, 0, 5_000_00],
      [0, 0, 5_000_00],
      // Parking, raised in 14 days, due 7 days later
      [0, 10_000_00, -5_000_00],
      [0, 0, -5_000_00],
      [0, 0, -5_000_00],
    ]);
    expect(f.weeks[1]!.items).toEqual([
      expect.objectContaining({
        kind: 'invoice',
        expected: day(13),
        lateDays: 10,
        amount: 30_000_00,
      }),
    ]);
    expect(f.weeks[3]!.items).toEqual([
      expect.objectContaining({
        kind: 'recurring_bill',
        label: 'Parking',
        expected: day(21),
        amount: -10_000_00,
      }),
    ]);
    expect(f.shortfall).toEqual({ start: today, balance: -25_000_00 });
    expect(f.lowest).toEqual({ start: today, balance: -25_000_00 });
    expect(f.overdue).toEqual({ inflow: 5_000_00, outflow: 0 });
    expect(f.lateCustomers).toEqual([
      { contact: { id: contact.kumar, name: 'Kumar Logistics' }, days: 10 },
    ]);
  });

  it('defaults to 13 weeks and checks what it is asked', async () => {
    expect(
      ((await as().get('/reports/cash-forecast').expect(200)).body as Forecast)
        .weeks,
    ).toHaveLength(13);
    await as().get('/reports/cash-forecast?weeks=99').expect(400);
    await http().get('/api/v1/reports/cash-forecast').expect(401);
  });
});
