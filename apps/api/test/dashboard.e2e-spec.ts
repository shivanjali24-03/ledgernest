import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { fiscalYearOf, fiscalYearSpan, todayIn } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Kpi = { value: number; previous: number; trend: number[] };
type Dash = {
  kpis: {
    cash: Kpi;
    receivables: Kpi;
    payables: Kpi;
    profit: Kpi & { since: string };
  };
  monthly: {
    month: string;
    income: number;
    expenses: number;
    profit: number;
    cash: number;
  }[];
  alerts: { kind: string; count: number; amount?: number }[];
  setup: Record<string, boolean>;
};

// Dated from today, so the test holds whenever it runs
const today = todayIn('Asia/Kolkata');
const [y, m] = today.split('-').map(Number) as [number, number];
const lastMonth = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
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
    };
  };
  const entry = async (
    date: string,
    lines: [string, number, number][],
    post = true,
  ) => {
    const d = await as()
      .post('/journals', {
        date,
        memo: 'Test',
        lines: lines.map(([a, debit, credit]) => ({
          accountId: acc[a],
          debit,
          credit,
        })),
      })
      .expect(201);
    if (post) await as().post(`/journals/${d.body.id}/post`).expect(200);
  };

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
          name: `Dashboard ${run}`,
          slug: `dash-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          timeZone: 'Asia/Kolkata',
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
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['capital', { code: '3100', type: 'equity', subtype: 'owner_equity' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: key, ...body })
          .expect(201)
      ).body.id;
    }
    for (const fy of new Set([
      fiscalYearOf(lastMonth, 4),
      fiscalYearOf(today, 4),
    ]))
      await as().post('/fiscal-years', { startYear: fy }).expect(201);
    const kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    // Last month: capital in, and an invoice that's now overdue
    await entry(lastMonth, [
      ['bank', 1_000_000, 0],
      ['capital', 0, 1_000_000],
    ]);
    const inv = (
      await as()
        .post('/invoices', {
          contactId: kumar,
          issueDate: lastMonth,
          dueDate: lastMonth,
          lines: [
            {
              description: 'Work',
              quantity: 1,
              unitPrice: 400_000,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body;
    await as().post(`/invoices/${inv.id}/issue`).expect(200);
    // This month: rent from the bank, and rent still owed
    await entry(today, [
      ['rent', 50_000, 0],
      ['bank', 0, 50_000],
    ]);
    await entry(today, [
      ['rent', 20_000, 0],
      ['creditors', 0, 20_000],
    ]);
    await entry(
      today,
      [
        ['rent', 1, 0],
        ['bank', 0, 1],
      ],
      false,
    );
    await as()
      .post('/recurring-invoices', {
        name: 'Retainer',
        contactId: kumar,
        frequency: 'monthly',
        startDate: today,
        lines: [
          {
            description: 'Retainer',
            quantity: 1,
            unitPrice: 100,
            accountId: acc.sales,
          },
        ],
      })
      .expect(201);
    await as()
      .post('/banking/statements/import', {
        bankAccountId: acc.bank,
        fileName: 's.csv',
        content: `Date,Narration,Amount\n${today},RENT,-500.00\n`,
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

  it('shows cash, receivables, payables and profit from the books, against last month', async () => {
    const d = (await as().get('/reports/dashboard').expect(200)).body as Dash;
    expect(d.kpis.cash).toMatchObject({ value: 950_000, previous: 1_000_000 });
    expect(d.kpis.receivables).toMatchObject({
      value: 400_000,
      previous: 400_000,
    });
    expect(d.kpis.payables).toMatchObject({ value: 20_000, previous: 0 });
    // Profit so far this financial year: last month's sale counts only if last month is in this year
    const sameYear =
      fiscalYearSpan(fiscalYearOf(today, 4), 4).startDate <= lastMonth;
    expect(d.kpis.profit.value).toBe(sameYear ? 330_000 : -70_000);
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly.at(-1)).toMatchObject({
      month: thisMonth,
      income: 0,
      expenses: 70_000,
      profit: -70_000,
      cash: 950_000,
    });
    expect(d.monthly.at(-2)).toMatchObject({
      income: 400_000,
      profit: 400_000,
      cash: 1_000_000,
    });
    expect(d.kpis.cash.trend.at(-1)).toBe(950_000);
  });

  it('lists what needs attention, and how far setup has got', async () => {
    const d = (await as().get('/reports/dashboard').expect(200)).body as Dash;
    const alert = (kind: string) => d.alerts.find((a) => a.kind === kind);
    expect(alert('overdue_invoices')).toEqual({
      kind: 'overdue_invoices',
      count: 1,
      amount: 400_000,
    });
    expect(alert('recurring_due')?.count).toBe(1);
    expect(alert('unreconciled')?.count).toBe(1);
    expect(alert('draft_entries')?.count).toBe(1);
    expect(alert('open_periods')!.count).toBeGreaterThan(0);
    expect(alert('overdue_bills')).toBeUndefined();
    expect(d.setup).toEqual({
      organisation: false,
      team: true,
      coa: true,
      fiscal: true,
      bank: true,
    });
  });

  it('shows a Viewer only what they may see', async () => {
    const d = (await as('viewer').get('/reports/dashboard').expect(200))
      .body as Dash;
    expect(d.kpis.cash.value).toBe(950_000);
    expect(d.alerts).toEqual([]);
  });
});
