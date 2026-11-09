import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Result = {
  saved: boolean;
  rows: number;
  valid: number;
  results: {
    row: number;
    ok: boolean;
    errors: { field: string | null; message: string }[];
    label?: string;
  }[];
  summary?: { debit: number; credit: number; difference: number };
  journalEntry?: { id: string } | null;
};

describe('Imports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
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
  const preview = async (kind: string, rows: object[], who = 'owner') =>
    (await as(who).post(`/imports/${kind}/preview`, { rows }).expect(200))
      .body as Result;
  const commit = async (kind: string, rows: object[], extra: object = {}) =>
    (
      await as()
        .post(`/imports/${kind}`, { rows, ...extra })
        .expect(200)
    ).body as Result;

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
          name: `Imports ${run}`,
          slug: `imports-${run}`,
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
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const chart = [
    {
      code: '1100.01',
      name: 'HDFC current account',
      type: 'Assets',
      subtype: 'bank',
      parentCode: '1100',
    },
    { code: '1100', name: 'Bank accounts', type: 'Assets', subtype: 'Bank' },
    {
      code: '1300',
      name: 'Debtors',
      type: 'asset',
      subtype: 'accounts receivable',
    },
    {
      code: '2100',
      name: 'Creditors',
      type: 'Liabilities',
      subtype: 'accounts_payable',
    },
    { code: '3100', name: 'Capital', type: 'Equity' },
    { code: '4100', name: 'Sales', type: 'Revenue' },
    { code: '5300', name: 'Rent', type: 'Expenses' },
  ];

  it('checks every row of a chart of accounts and saves nothing until all are right', async () => {
    const bad = await preview('accounts', [
      ...chart,
      { code: '9000', name: 'Odd', type: 'stuff' },
      { code: '9100', name: 'Orphan', type: 'expense', parentCode: '8888' },
      { code: '', name: 'No code', type: 'asset' },
    ]);
    expect(bad).toMatchObject({ saved: false, rows: 10, valid: 7 });
    expect(bad.results[7]!.errors[0]).toMatchObject({ field: 'type' });
    expect(bad.results[8]!.errors[0]).toMatchObject({
      field: 'parentCode',
      message: 'There’s no account with the code 8888.',
    });
    expect(bad.results[9]!.errors[0]).toMatchObject({
      field: 'code',
      message: 'This is required.',
    });
    expect(
      await prisma.account.count({
        where: { organizationId: org, systemKey: null },
      }),
    ).toBe(0);
    expect(
      (
        await commit('accounts', [
          ...chart,
          { code: '9000', name: 'Odd', type: 'stuff' },
        ])
      ).saved,
    ).toBe(false);
    expect(
      await prisma.account.count({
        where: { organizationId: org, systemKey: null },
      }),
    ).toBe(0);
  });

  it('imports the chart, parents first whatever their order, and refuses duplicates afterwards', async () => {
    const ok = await commit('accounts', chart);
    expect(ok).toMatchObject({ saved: true, valid: 7 });
    const sub = await prisma.account.findFirstOrThrow({
      where: { organizationId: org, code: '1100.01' },
      select: { parent: { select: { code: true } }, subtype: true },
    });
    expect(sub).toEqual({ parent: { code: '1100' }, subtype: 'bank' });
    const again = await preview('accounts', [chart[2]!]);
    expect(again.results[0]!.ok).toBe(false);
  });

  it('imports contacts and items, with their accounts by code', async () => {
    const contacts = await commit('contacts', [
      {
        name: 'Kumar Logistics',
        kind: 'Customer',
        email: 'accounts@kumar.example',
        city: 'Pune',
        region: 'Maharashtra',
        country: 'IN',
        paymentTermsDays: '15 days',
      },
      { name: 'Sharma Office Supplies', kind: 'Supplier' },
      { name: 'Both Ways Ltd', kind: 'both', currency: 'INR' },
    ]);
    expect(contacts).toMatchObject({ saved: true, valid: 3 });
    expect(
      (
        await prisma.contact.findFirstOrThrow({
          where: { organizationId: org, name: 'Kumar Logistics' },
        })
      ).paymentTermsDays,
    ).toBe(15);
    const badContact = await preview('contacts', [
      { name: 'Who', kind: 'friend' },
      { name: 'Bad mail', email: 'nope' },
    ]);
    expect(badContact.results.map((r) => r.errors[0]?.field)).toEqual([
      'kind',
      'email',
    ]);

    const items = await commit('items', [
      {
        name: 'Consulting',
        kind: 'Service',
        unit: 'hrs',
        salePrice: '2,500.00',
        hsnSac: '998311',
        incomeAccountCode: '4100',
      },
      {
        name: 'Printer paper',
        kind: 'goods',
        purchasePrice: '280',
        expenseAccountCode: '5300',
      },
    ]);
    expect(items).toMatchObject({ saved: true, valid: 2 });
    expect(
      (
        await prisma.item.findFirstOrThrow({
          where: { organizationId: org, name: 'Consulting' },
        })
      ).salePrice,
    ).toBe(250_000n);
    expect(
      (await preview('items', [{ name: 'X', incomeAccountCode: '7777' }]))
        .results[0]!.errors[0],
    ).toMatchObject({ field: 'incomeAccountCode' });
  });

  it('turns opening balances into a draft entry, balanced to Opening balance equity', async () => {
    const rows = [
      { accountCode: '1100.01', debit: '5,00,000' },
      { accountCode: '1300', debit: '1,20,000.50' },
      { accountCode: '2100', credit: '80,000' },
      { accountCode: '1100', debit: '1' },
    ];
    const p = (
      await as().post('/imports/opening_balances/preview', { rows }).expect(200)
    ).body as Result;
    expect(p.results[3]!.errors[0]!.message).toMatch(/sub-accounts/);
    const done = await commit('opening_balances', rows.slice(0, 3), {
      date: '2026-04-01',
    });
    expect(done.summary).toEqual({
      debit: 62_000_050,
      credit: 8_000_000,
      difference: 54_000_050,
    });
    const e = (await as().get(`/journals/${done.journalEntry!.id}`).expect(200))
      .body as {
      status: string;
      date: string;
      lines: { account: { code: string }; debit: number; credit: number }[];
    };
    expect(e).toMatchObject({ status: 'draft', date: '2026-04-01' });
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['1100.01', 50_000_000, 0],
      ['1300', 12_000_050, 0],
      ['2100', 0, 8_000_000],
      ['3990', 0, 54_000_050],
    ]);
  });

  it('checks a big file in one go, far bigger than an ordinary request', async () => {
    const rows = Array.from({ length: 1500 }, (_x, n) => ({
      name: `Customer number ${n} with a reasonably long trading name Pvt Ltd`,
      kind: 'customer',
      email: `buyer${n}@customer-${n}.example.com`,
      notes:
        'Imported from the old system, with notes that make each row longer than a few bytes.',
    }));
    const res = await preview('contacts', rows);
    expect(res).toMatchObject({ rows: 1500, valid: 1500, saved: false });
  });

  it('needs the same permission as adding by hand, and audits imports', async () => {
    expect(
      (
        await as('viewer')
          .post('/imports/accounts/preview', { rows: chart })
          .expect(403)
      ).body.details.missing,
    ).toEqual(['accounts.manage']);
    await as().post('/imports/cheques', { rows: chart }).expect(400);
    await as().post('/imports/accounts', { rows: [] }).expect(400);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.import.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.import.accounts',
        'org.import.contacts',
        'org.import.items',
        'org.import.opening_balances',
      ]),
    );
  });
});
