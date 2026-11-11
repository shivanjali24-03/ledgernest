import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Report = {
  asOf: string;
  fiscalYear: { from: string; to: string };
  bills: {
    number: string;
    vendorReference: string | null;
    vendor: { name: string; category: string; udyamNumber: string | null };
    deadline: string;
    balance: number;
    state: string;
    disallowed: number;
  }[];
  totals: {
    overdue: number;
    dueSoon: number;
    disallowed: number;
    paidLate: number;
  };
};

describe('MSME 45-day payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const vendor: Record<string, string> = {};
  let org = '';
  let token = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const record = async (
    contactId: string,
    vendorReference: string,
    billDate: string,
    unitPrice: number,
    dueDate?: string,
  ) => {
    const b = (
      await post('/bills', {
        contactId,
        vendorReference,
        billDate,
        ...(dueDate ? { dueDate } : {}),
        lines: [
          {
            description: 'Fabrication',
            quantity: 1,
            unitPrice,
            accountId: acc.jobwork,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/bills/${b.id}/record`).expect(200);
    return b.id;
  };
  const pay = (
    contactId: string,
    billId: string,
    date: string,
    amount: number,
  ) =>
    post('/payments/payments', {
      contactId,
      date,
      bankAccountId: acc.bank,
      amount,
      allocations: [{ billId, amount }],
    }).expect(201);

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
          name: `MSME ${run}`,
          slug: `msme-${run}`,
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
    token = await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['jobwork', { code: '5100', type: 'expense', subtype: 'cost_of_sales' }],
    ] as const) {
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    }
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('keeps a vendor’s Udyam number and category, and checks the number', async () => {
    expect(
      (
        await post('/contacts', {
          name: 'Bad Udyam',
          isVendor: true,
          isCustomer: false,
          udyamNumber: 'UDYAM-12',
        }).expect(400)
      ).body.details,
    ).toMatchObject([{ field: 'udyamNumber' }]);
    const c = (
      await post('/contacts', {
        name: 'Sharma Fabricators',
        isVendor: true,
        isCustomer: false,
        paymentTermsDays: 30,
        msmeCategory: 'micro',
        udyamNumber: 'udyam-mh-26-0012345',
      }).expect(201)
    ).body as { id: string; msmeCategory: string; udyamNumber: string };
    expect(c).toMatchObject({
      msmeCategory: 'micro',
      udyamNumber: 'UDYAM-MH-26-0012345',
    });
    vendor.sharma = c.id;
    vendor.big = (
      await post('/contacts', {
        name: 'Big Steel Ltd',
        isVendor: true,
        isCustomer: false,
        msmeCategory: 'medium',
      }).expect(201)
    ).body.id;
    vendor.plain = (
      await post('/contacts', {
        name: 'Office Mart',
        isVendor: true,
        isCustomer: false,
      }).expect(201)
    ).body.id;
    // Becoming small later, by an edit
    await patch(`/contacts/${vendor.plain}`, { msmeCategory: 'small' }).expect(
      200,
    );
    await patch(`/contacts/${vendor.plain}`, { msmeCategory: null }).expect(
      200,
    );
  });

  it('shows each micro or small supplier’s bills against the deadline, and what 43B(h) takes out of the year', async () => {
    // Paid on time, paid late, part-paid and overdue, due soon, and agreed terms longer than 45 days (capped)
    const onTime = await record(
      vendor.sharma,
      'SF-101',
      '2026-06-01',
      50_000_00,
    );
    await pay(vendor.sharma, onTime, '2026-06-25', 50_000_00);
    const late = await record(vendor.sharma, 'SF-102', '2026-06-01', 30_000_00);
    await pay(vendor.sharma, late, '2026-07-20', 30_000_00);
    const owed = await record(vendor.sharma, 'SF-103', '2026-06-01', 40_000_00);
    await pay(vendor.sharma, owed, '2026-06-20', 10_000_00);
    await record(vendor.sharma, 'SF-104', '2026-07-10', 20_000_00);
    await record(
      vendor.sharma,
      'SF-105',
      '2026-07-25',
      15_000_00,
      '2026-10-15',
    );
    // Medium and non-MSME vendors aren't covered
    await record(vendor.big, 'BS-1', '2026-06-01', 90_000_00);
    await record(vendor.plain, 'OM-1', '2026-06-01', 5_000_00);

    const r = (await get('/reports/msme?date=2026-08-04').expect(200))
      .body as Report;
    expect(r.fiscalYear).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(
      r.bills.map((b) => [b.vendorReference, b.state, b.deadline, b.balance]),
    ).toEqual([
      ['SF-103', 'overdue', '2026-07-01', 30_000_00],
      ['SF-104', 'due_soon', '2026-08-09', 20_000_00],
      ['SF-105', 'open', '2026-09-08', 15_000_00],
      ['SF-102', 'paid_late', '2026-07-01', 0],
      ['SF-101', 'paid_on_time', '2026-07-01', 0],
    ]);
    expect(r.bills[0]!.vendor).toMatchObject({
      name: 'Sharma Fabricators',
      category: 'micro',
      udyamNumber: 'UDYAM-MH-26-0012345',
    });
    expect(r.totals).toEqual({
      overdue: 30_000_00,
      dueSoon: 20_000_00,
      // Only what's still owed past its deadline; SF-102 was paid late but within the year
      disallowed: 30_000_00,
      paidLate: 30_000_00,
    });
  });

  it('puts what’s overdue or due within the week on the dashboard', async () => {
    const d = (await get('/reports/dashboard').expect(200)).body as {
      alerts: { kind: string; count: number; amount?: number }[];
    };
    // Today all of them are past the deadline: SF-103, SF-104 and SF-105 (and the medium vendor's bill isn't counted)
    expect(d.alerts.find((a) => a.kind === 'msme_due')).toEqual({
      kind: 'msme_due',
      count: 3,
      amount: 65_000_00,
    });
  });
});
