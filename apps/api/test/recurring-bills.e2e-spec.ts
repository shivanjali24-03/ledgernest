import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RecurringBillsService } from '../src/recurring/recurring-bills.service.js';
import { setupApp } from '../src/setup-app.js';

type Schedule = {
  id: string;
  status: string;
  count: number;
  nextDate: string | null;
  lastError: string | null;
  bills: {
    id: string;
    number: string | null;
    status: string;
    billDate: string;
    total: number;
  }[];
};

describe('Recurring bills (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let landlord = '';
  let customer = '';

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
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const rent = (over: object = {}) => ({
    name: 'Office rent',
    contactId: landlord,
    frequency: 'monthly',
    startDate: '2026-05-01',
    maxCount: 12,
    notes: 'Baner office',
    lines: [
      {
        description: 'Rent for the month',
        quantity: '1',
        unitPrice: 85_000_00,
        accountId: acc.rent,
      },
    ],
    ...over,
  });

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
          name: `Recurring bills ${run}`,
          slug: `recurring-bills-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    landlord = (
      await as()
        .post('/contacts', {
          name: 'Baner Estates',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
    customer = (
      await as()
        .post('/contacts', {
          name: 'Only A Customer',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let drafts = '';

  it('makes the missed months as draft bills, catching up oldest first', async () => {
    const s = (await as().post('/recurring-bills', rent()).expect(201))
      .body as Schedule;
    drafts = s.id;
    expect(s).toMatchObject({
      status: 'active',
      count: 0,
      nextDate: '2026-05-01',
    });
    const svc = app.get(RecurringBillsService);
    const r = await svc.run(org, undefined, '2026-07-10');
    expect(r.made.map((m) => [m.date, m.recorded])).toEqual([
      ['2026-05-01', false],
      ['2026-06-01', false],
      ['2026-07-01', false],
    ]);
    const after = (await as().get(`/recurring-bills/${s.id}`).expect(200))
      .body as Schedule;
    expect(after).toMatchObject({
      count: 3,
      nextDate: '2026-08-01',
      lastError: null,
    });
    expect(after.bills.map((b) => [b.billDate, b.status, b.total])).toEqual([
      ['2026-07-01', 'draft', 85_000_00],
      ['2026-06-01', 'draft', 85_000_00],
      ['2026-05-01', 'draft', 85_000_00],
    ]);
    // Running again the same day makes nothing more
    expect((await svc.run(org, undefined, '2026-07-10')).made).toEqual([]);
  });

  it('records each bill when asked, and stops at its last one', async () => {
    const s = (
      await as()
        .post(
          '/recurring-bills',
          rent({
            name: 'Cloud hosting',
            startDate: '2026-06-15',
            maxCount: 2,
            autoRecord: true,
          }),
        )
        .expect(201)
    ).body as Schedule;
    const r = await app
      .get(RecurringBillsService)
      .run(org, undefined, '2026-08-31');
    expect(
      r.made.filter((m) => m.scheduleId === s.id).map((m) => m.recorded),
    ).toEqual([true, true]);
    const after = (await as().get(`/recurring-bills/${s.id}`).expect(200))
      .body as Schedule;
    expect(after).toMatchObject({ status: 'ended', count: 2, nextDate: null });
    expect(
      after.bills.every(
        (b) => b.status === 'open' && (b.number ?? '').startsWith('BILL/'),
      ),
    ).toBe(true);
  });

  it('pauses and resumes, and keeps schedules with bills', async () => {
    expect(
      (await as().post(`/recurring-bills/${drafts}/pause`).expect(200)).body
        .status,
    ).toBe('paused');
    expect(
      (
        await app.get(RecurringBillsService).run(org, undefined, '2026-09-10')
      ).made.filter((m) => m.scheduleId === drafts),
    ).toEqual([]);
    expect(
      (await as().post(`/recurring-bills/${drafts}/resume`).expect(200)).body
        .status,
    ).toBe('active');
    expect(
      (await as().delete(`/recurring-bills/${drafts}`).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'has_bills' });
  });

  it('only takes vendors, and needs bill permissions to change', async () => {
    expect(
      (
        await as()
          .post('/recurring-bills', rent({ contactId: customer }))
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'not_vendor' });
    await as('auditor').get('/recurring-bills').expect(200);
    await as('auditor').post('/recurring-bills', rent()).expect(403);
    const actions = await prisma.auditLog.findMany({
      where: { organizationId: org, entityType: 'recurring_bill' },
      select: { action: true },
    });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set([
        'org.recurring_bill.create',
        'org.recurring_bill.raise',
        'org.recurring_bill.pause',
        'org.recurring_bill.resume',
      ]),
    );
  });
});
