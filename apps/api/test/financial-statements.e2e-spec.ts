import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Row = {
  code: string;
  depth: number;
  hasChildren: boolean;
  amounts: number[];
};
type Pnl = {
  columns: { from: string; to: string }[];
  sections: { section: string; rows: Row[]; total: number[] }[];
  grossProfit: number[];
  operatingProfit: number[];
  netProfit: number[];
};
type Bs = {
  sections: { section: string; rows: Row[]; total: number[] }[];
  profitThisYear: number[];
  profitEarlierYears: number[];
  totalAssets: number[];
  totalLiabilities: number[];
  totalEquity: number[];
  balanced: boolean[];
};

describe('Profit and loss, and balance sheet (e2e)', () => {
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
  const post = async (date: string, lines: [string, number, number][]) => {
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
  const section = (r: Pnl | Bs, name: string) =>
    r.sections.find((s) => s.section === name)!;

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
          name: `Statements ${run}`,
          slug: `fin-${run}`,
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
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['laptops', { code: '1710', type: 'asset', subtype: 'fixed_asset' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'loan',
        { code: '2800', type: 'liability', subtype: 'long_term_liability' },
      ],
      ['capital', { code: '3100', type: 'equity', subtype: 'owner_equity' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['interest', { code: '4500', type: 'income', subtype: 'other_income' }],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
      ['salaries', { code: '5200', type: 'expense', subtype: 'payroll' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
      [
        'bankInterest',
        { code: '5950', type: 'expense', subtype: 'other_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: key, ...body })
          .expect(201)
      ).body.id;
    }
    acc.services = (
      await as()
        .post('/accounts', {
          code: '4110',
          name: 'services',
          type: 'income',
          subtype: 'operating_income',
          parentId: acc.sales,
        })
        .expect(201)
    ).body.id;
    for (const y of [2025, 2026])
      await as().post('/fiscal-years', { startYear: y }).expect(201);
    // Last financial year (not closed): ₹1,500 profit
    await post('2025-04-01', [
      ['bank', 50_000_000, 0],
      ['capital', 0, 50_000_000],
    ]);
    await post('2025-06-15', [
      ['debtors', 200_000, 0],
      ['services', 0, 200_000],
    ]);
    await post('2025-06-20', [
      ['rent', 50_000, 0],
      ['bank', 0, 50_000],
    ]);
    // This year, April and May
    await post('2026-04-10', [
      ['debtors', 300_000, 0],
      ['services', 0, 300_000],
    ]);
    await post('2026-04-15', [
      ['cogs', 120_000, 0],
      ['creditors', 0, 120_000],
    ]);
    await post('2026-05-05', [
      ['rent', 50_000, 0],
      ['bank', 0, 50_000],
    ]);
    await post('2026-05-20', [
      ['salaries', 80_000, 0],
      ['bank', 0, 80_000],
    ]);
    await post('2026-05-25', [
      ['bank', 10_000, 0],
      ['interest', 0, 10_000],
    ]);
    await post('2026-05-28', [
      ['bankInterest', 5_000, 0],
      ['bank', 0, 5_000],
    ]);
    await post('2026-05-30', [
      ['laptops', 100_000, 0],
      ['bank', 0, 100_000],
    ]);
    await post('2026-05-31', [
      ['bank', 1_000_000, 0],
      ['loan', 0, 1_000_000],
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('works out gross, operating and net profit, sub-accounts within their parents', async () => {
    const p = (
      await as('viewer')
        .get('/reports/profit-and-loss?from=2026-04-01&to=2026-05-31')
        .expect(200)
    ).body as Pnl;
    expect(
      section(p, 'revenue').rows.map((r) => [
        r.code,
        r.depth,
        r.hasChildren,
        r.amounts[0],
      ]),
    ).toEqual([
      ['4100', 0, true, 300_000],
      ['4110', 1, false, 300_000],
    ]);
    expect(section(p, 'revenue').total).toEqual([300_000]);
    expect(section(p, 'costOfSales').total).toEqual([120_000]);
    expect(p.grossProfit).toEqual([180_000]);
    expect(
      section(p, 'operatingExpenses').rows.map((r) => [r.code, r.amounts[0]]),
    ).toEqual([
      ['5200', 80_000],
      ['5300', 50_000],
    ]);
    expect(p.operatingProfit).toEqual([50_000]);
    expect([
      section(p, 'otherIncome').total,
      section(p, 'otherExpenses').total,
    ]).toEqual([[10_000], [5_000]]);
    expect(p.netProfit).toEqual([55_000]);
  });

  it('compares month by month, and with last year', async () => {
    const m = (
      await as()
        .get(
          '/reports/profit-and-loss?from=2026-04-01&to=2026-05-31&compare=months',
        )
        .expect(200)
    ).body as Pnl;
    expect(m.columns).toEqual([
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2026-05-01', to: '2026-05-31' },
    ]);
    expect(m.netProfit).toEqual([180_000, -125_000]);
    const y = (
      await as()
        .get(
          '/reports/profit-and-loss?from=2026-06-01&to=2026-06-30&compare=year',
        )
        .expect(200)
    ).body as Pnl;
    expect(y.columns[1]).toEqual({ from: '2025-06-01', to: '2025-06-30' });
    expect(y.netProfit).toEqual([0, 150_000]);
  });

  it('balances: assets against liabilities and equity, with unclosed profit in equity', async () => {
    const b = (
      await as()
        .get('/reports/balance-sheet?asOf=2026-05-31&compareAsOf=2026-03-31')
        .expect(200)
    ).body as Bs;
    expect(
      section(b, 'currentAssets').rows.map((r) => [r.code, ...r.amounts]),
    ).toEqual([
      ['1100', 50_725_000, 49_950_000],
      ['1300', 500_000, 200_000],
    ]);
    expect(section(b, 'nonCurrentAssets').total).toEqual([100_000, 0]);
    expect(b.totalAssets).toEqual([51_325_000, 50_150_000]);
    expect([
      section(b, 'currentLiabilities').total,
      section(b, 'nonCurrentLiabilities').total,
    ]).toEqual([
      [120_000, 0],
      [1_000_000, 0],
    ]);
    // This year's ₹550 so far, and last year's ₹1,500 not closed yet; on 31 March that ₹1,500 was the year's own
    expect(b.profitThisYear).toEqual([55_000, 150_000]);
    expect(b.profitEarlierYears).toEqual([150_000, 0]);
    expect(b.totalEquity).toEqual([50_205_000, 50_150_000]);
    expect(b.balanced).toEqual([true, true]);
  });

  it('exports both as CSV', async () => {
    const p = await as()
      .get('/reports/profit-and-loss/export?from=2026-04-01&to=2026-05-31')
      .expect(200);
    const pl = p.text
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(pl).toContain('revenue,4110,  services,3000.00');
    expect(pl).toContain(',,Gross profit,1800.00');
    expect(pl.at(-1)).toBe(',,Net profit,550.00');
    const b = await as()
      .get('/reports/balance-sheet/export?asOf=2026-05-31')
      .expect(200);
    const bl = b.text
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(bl).toContain(',,Total assets,513250.00');
    expect(bl.at(-1)).toBe(',,Total liabilities and equity,513250.00');
    await as('viewer')
      .get('/reports/balance-sheet/export?asOf=2026-05-31')
      .expect(403);
  });
});
