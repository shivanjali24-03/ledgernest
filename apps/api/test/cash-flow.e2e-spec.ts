import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Row = { code: string; amount: number };
type CashFlow = {
  openingCash: number;
  closingCash: number;
  netChange: number;
  indirect: {
    netProfit: number;
    depreciation: number;
    workingCapital: Row[];
    operating: number;
    investingRows: Row[];
    investing: number;
    financingRows: Row[];
    financing: number;
    total: number;
  };
  direct: Record<string, number>;
};

describe('Cash flow statement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = () => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users.owner!.token}`)
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
          name: `Cash flow ${run}`,
          slug: `cf-${run}`,
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
    users.owner = {
      id: u.id,
      token: await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      ),
    };
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['cash', { code: '1200', type: 'asset', subtype: 'cash' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['laptops', { code: '1710', type: 'asset', subtype: 'fixed_asset' }],
      ['accDep', { code: '1790', type: 'asset', subtype: 'fixed_asset' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['gst', { code: '2200', type: 'liability', subtype: 'tax_payable' }],
      [
        'loan',
        { code: '2800', type: 'liability', subtype: 'long_term_liability' },
      ],
      ['capital', { code: '3100', type: 'equity', subtype: 'owner_equity' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
      ['salaries', { code: '5200', type: 'expense', subtype: 'payroll' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
      [
        'depreciation',
        { code: '5700', type: 'expense', subtype: 'depreciation' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: key, ...body })
          .expect(201)
      ).body.id;
    }
    for (const y of [2025, 2026])
      await as().post('/fiscal-years', { startYear: y }).expect(201);
    await post('2026-03-31', [
      ['bank', 1_000_000, 0],
      ['capital', 0, 1_000_000],
    ]);
    await post('2026-04-05', [
      ['debtors', 118_000, 0],
      ['sales', 0, 100_000],
      ['gst', 0, 18_000],
    ]);
    await post('2026-04-20', [
      ['bank', 118_000, 0],
      ['debtors', 0, 118_000],
    ]);
    await post('2026-04-25', [
      ['debtors', 50_000, 0],
      ['sales', 0, 50_000],
    ]);
    await post('2026-05-01', [
      ['laptops', 200_000, 0],
      ['bank', 0, 200_000],
    ]);
    await post('2026-05-10', [
      ['cogs', 30_000, 0],
      ['creditors', 0, 30_000],
    ]);
    await post('2026-05-15', [
      ['creditors', 20_000, 0],
      ['bank', 0, 20_000],
    ]);
    await post('2026-05-31', [
      ['salaries', 40_000, 0],
      ['bank', 0, 40_000],
    ]);
    await post('2026-06-01', [
      ['gst', 18_000, 0],
      ['bank', 0, 18_000],
    ]);
    await post('2026-06-10', [
      ['cash', 5_000, 0],
      ['bank', 0, 5_000],
    ]);
    await post('2026-06-15', [
      ['rent', 3_000, 0],
      ['cash', 0, 3_000],
    ]);
    await post('2026-06-30', [
      ['depreciation', 10_000, 0],
      ['accDep', 0, 10_000],
    ]);
    await post('2026-06-30', [
      ['bank', 100_000, 0],
      ['loan', 0, 100_000],
    ]);
    await post('2026-06-30', [
      ['capital', 7_000, 0],
      ['bank', 0, 7_000],
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('reconciles profit to cash, indirectly', async () => {
    const c = (
      await as()
        .get('/reports/cash-flow?from=2026-04-01&to=2026-06-30')
        .expect(200)
    ).body as CashFlow;
    expect(c).toMatchObject({
      openingCash: 1_000_000,
      closingCash: 930_000,
      netChange: -70_000,
    });
    const i = c.indirect;
    // ₹670 profit, ₹100 depreciation back, ₹500 more owed by customers, ₹100 more owed to vendors
    expect([i.netProfit, i.depreciation]).toEqual([67_000, 10_000]);
    expect(i.workingCapital.map((r) => [r.code, r.amount])).toEqual([
      ['1300', -50_000],
      ['2100', 10_000],
    ]);
    expect(i.operating).toBe(37_000);
    // A ₹2,000 laptop; its depreciation moved no cash
    expect(i.investing).toBe(-200_000);
    expect(i.financingRows.map((r) => [r.code, r.amount])).toEqual([
      ['2800', 100_000],
      ['3100', -7_000],
    ]);
    expect(i.financing).toBe(93_000);
    expect(i.total).toBe(c.netChange);
  });

  it('shows the same cash by what it was for, directly; transfers between cash accounts cancel out', async () => {
    const d = (
      (
        await as()
          .get('/reports/cash-flow?from=2026-04-01&to=2026-06-30')
          .expect(200)
      ).body as CashFlow
    ).direct;
    expect(d).toMatchObject({
      customers: 118_000,
      vendors: -23_000,
      staff: -40_000,
      taxes: -18_000,
      otherReceipts: 0,
      otherPayments: 0,
      operating: 37_000,
      investing: -200_000,
      financing: 93_000,
      total: -70_000,
    });
  });

  it('exports CSV', async () => {
    const r = await as()
      .get('/reports/cash-flow/export?from=2026-04-01&to=2026-06-30')
      .expect(200);
    const lines = r.text
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines).toContain('operating,Cash from operating activities,370.00');
    expect(lines.at(-1)).toBe(',Cash at the end,9300.00');
  });
});
