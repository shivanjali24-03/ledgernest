import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Grid = {
  id: string;
  name: string;
  months: string[];
  rows: { accountId: string; code: string; amounts: number[]; total: number }[];
};
type Comparison = {
  months: number;
  sections: {
    section: string;
    budget: number;
    actual: number;
    variance: number;
    rows: {
      code: string;
      budget: number;
      actual: number;
      variance: number;
      percent: number | null;
    }[];
  }[];
  netProfit: { budget: number; actual: number; variance: number };
};

describe('Budgets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const years: Record<number, string> = {};
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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const entry = async (date: string, lines: [string, number, number][]) => {
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
    await as().post(`/journals/${d.body.id}/post`).expect(200);
  };
  const row = (g: Grid, key: string) =>
    g.rows.find((r) => r.accountId === acc[key])!;

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
          name: `Budgets ${run}`,
          slug: `budgets-${run}`,
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
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
      [
        'travel',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    for (const y of [2025, 2026])
      years[y] = (
        await as().post('/fiscal-years', { startYear: y }).expect(201)
      ).body.id;
    await entry('2025-05-10', [
      ['bank', 100_000_00, 0],
      ['sales', 0, 100_000_00],
    ]);
    await entry('2025-06-01', [
      ['rent', 40_000_00, 0],
      ['bank', 0, 40_000_00],
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let budget = '';

  it('starts a budget from last year’s actuals, ten per cent up, month for month', async () => {
    const g = (
      await as()
        .post('/budgets', {
          name: 'Plan',
          fiscalYearId: years[2026],
          startFrom: 'actuals',
          adjustPercent: 10,
        })
        .expect(201)
    ).body as Grid;
    budget = g.id;
    expect(g.months[0]).toBe('2026-04');
    expect(g.months[11]).toBe('2027-03');
    expect(row(g, 'sales').amounts[1]).toBe(110_000_00);
    expect(row(g, 'rent').amounts[2]).toBe(44_000_00);
    expect(row(g, 'travel').total).toBe(0);
    expect(g.rows.some((r) => r.code === '1100')).toBe(false);
    expect(
      (
        await as()
          .post('/budgets', {
            name: 'Plan',
            fiscalYearId: years[2026],
            startFrom: 'empty',
          })
          .expect(409)
      ).body.details.reason,
    ).toBe('name_taken');
  });

  it('edits an account’s months and leaves the others alone', async () => {
    const amounts = Array.from({ length: 12 }, () => 5_000_00);
    const g = (
      await as()
        .put(`/budgets/${budget}/lines`, {
          lines: [{ accountId: acc.travel, amounts }],
        })
        .expect(200)
    ).body as Grid;
    expect(row(g, 'travel').total).toBe(60_000_00);
    expect(row(g, 'sales').amounts[1]).toBe(110_000_00);
    expect(
      (
        await as()
          .put(`/budgets/${budget}/lines`, {
            lines: [{ accountId: acc.bank, amounts }],
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('not_pnl_account');
  });

  it('copies a budget and lists them with their totals', async () => {
    const copy = (
      await as()
        .post('/budgets', {
          name: 'Stretch',
          fiscalYearId: years[2026],
          startFrom: 'budget',
          budgetId: budget,
          adjustPercent: -50,
        })
        .expect(201)
    ).body as Grid;
    expect(row(copy, 'travel').amounts[0]).toBe(2_500_00);
    const list = (await as('viewer').get('/budgets').expect(200)).body as {
      name: string;
      income: number;
      expenses: number;
      profit: number;
    }[];
    expect(list.find((b) => b.name === 'Plan')).toMatchObject({
      income: 110_000_00,
      expenses: 104_000_00,
      profit: 6_000_00,
    });
    await as().patch(`/budgets/${copy.id}`, { name: 'Plan' }).expect(409);
    await as().patch(`/budgets/${copy.id}`, { name: 'Lean' }).expect(200);
    await as().delete(`/budgets/${copy.id}`).expect(204);
    expect(
      ((await as().get('/budgets').expect(200)).body as unknown[]).length,
    ).toBe(1);
  });

  it('compares budget against actual to date, with variances that read the right way round', async () => {
    await entry('2026-05-12', [
      ['bank', 120_000_00, 0],
      ['sales', 0, 120_000_00],
    ]);
    await entry('2026-06-02', [
      ['rent', 50_000_00, 0],
      ['bank', 0, 50_000_00],
    ]);
    const c = (
      await as('viewer')
        .get(`/budgets/${budget}/comparison?upTo=2026-06-30`)
        .expect(200)
    ).body as Comparison;
    expect(c.months).toBe(3);
    const rows = c.sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.code === '4100')).toMatchObject({
      budget: 110_000_00,
      actual: 120_000_00,
      variance: 10_000_00,
      percent: 9.1,
    });
    expect(rows.find((r) => r.code === '5300')).toMatchObject({
      budget: 44_000_00,
      actual: 50_000_00,
      variance: -6_000_00,
    });
    expect(rows.find((r) => r.code === '5400')).toMatchObject({
      budget: 15_000_00,
      actual: 0,
      variance: 15_000_00,
    });
    expect(c.netProfit).toEqual({
      budget: 51_000_00,
      actual: 70_000_00,
      variance: 19_000_00,
    });
  });

  it('is read-only for viewers and audited', async () => {
    await as('viewer')
      .post('/budgets', { name: 'X', fiscalYearId: years[2026] })
      .expect(403);
    await as('viewer').delete(`/budgets/${budget}`).expect(403);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.budget.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.budget.create',
        'org.budget.update',
        'org.budget.delete',
      ]),
    );
  });

  it('plans for one cost centre, comparing against that cost centre’s lines only', async () => {
    const cc = (
      await as()
        .post('/cost-centres', { code: 'PUNE', name: 'Pune office' })
        .expect(201)
    ).body.id as string;
    const d = await as()
      .post('/journals', {
        date: '2026-07-10',
        memo: 'Pune sale',
        lines: [
          { accountId: acc.bank, debit: 30_000_00 },
          { accountId: acc.sales, credit: 30_000_00, costCentreId: cc },
        ],
      })
      .expect(201);
    await as().post(`/journals/${d.body.id}/post`).expect(200);
    const g = (
      await as()
        .post('/budgets', {
          name: 'Pune plan',
          fiscalYearId: years[2026],
          startFrom: 'empty',
          costCentreId: cc,
        })
        .expect(201)
    ).body as Grid & { costCentre: { code: string } };
    expect(g.costCentre).toMatchObject({ code: 'PUNE' });
    const c = (
      await as().get(`/budgets/${g.id}/comparison?upTo=2026-07-31`).expect(200)
    ).body as Comparison;
    // Only the Pune sale counts, not the rest of the organisation's
    expect(
      c.sections.flatMap((s) => s.rows).find((r) => r.code === '4100'),
    ).toMatchObject({ actual: 30_000_00 });
    expect(
      (
        (await as().get('/budgets').expect(200)).body as {
          name: string;
          costCentre: { code: string } | null;
        }[]
      ).find((b) => b.name === 'Pune plan')!.costCentre,
    ).toMatchObject({ code: 'PUNE' });
    expect(
      (await as().delete(`/cost-centres/${cc}`).expect(409)).body.details
        .reason,
    ).toBe('in_use');
    await as()
      .post('/budgets', {
        name: 'Nowhere',
        fiscalYearId: years[2026],
        startFrom: 'empty',
        costCentreId: randomUUID(),
      })
      .expect(400);
  });
});
