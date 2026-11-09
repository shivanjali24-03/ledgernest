import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type TbRow = { code: string; debit: number; credit: number; balanceDebit: number; balanceCredit: number };

describe('General ledger and trial balance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let orgA = '';
  let orgB = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return { get: (p: string) => auth(http().get(`/api/v1${p}`)), post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body) };
  };
  const postEntry = async (date: string, lines: [string, number, number][], memo = 'Test') => {
    const d = await as('owner').post('/journals', { date, memo, lines: lines.map(([a, debit, credit]) => ({ accountId: acc[a], debit, credit })) }).expect(201);
    await as('owner').post(`/journals/${d.body.id}/post`).expect(200);
    return d.body.id as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `Reports A ${run}`, slug: `reports-a-${run}`, fiscalYearStartMonth: 4 } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Reports B ${run}`, slug: `reports-b-${run}` } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['viewer', orgA, 'viewer'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    for (const [key, code, type, subtype] of [
      ['bank', '1100', 'asset', 'bank'],
      ['capital', '3000', 'equity', 'owner_equity'],
      ['sales', '4000', 'income', 'operating_income'],
      ['rent', '5300', 'expense', 'operating_expense'],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: orgA, code, name: `${key} ${run}`, type, subtype } })).id;
    }
    await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(201);
    await postEntry('2026-04-01', [['bank', 1000000, 0], ['capital', 0, 1000000]], 'Capital introduced');
    await postEntry('2026-05-10', [['bank', 250000, 0], ['sales', 0, 250000]], 'Sale');
    await postEntry('2026-05-31', [['rent', 80000, 0], ['bank', 0, 80000]], 'Rent');
    // A draft never counts
    await as('owner').post('/journals', { date: '2026-05-15', lines: [{ accountId: acc.rent, debit: 999 }, { accountId: acc.bank, credit: 999 }] }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('the trial balance lists every account and balances, counting only posted entries up to the date', async () => {
    const tb = (await as('viewer').get('/reports/trial-balance?asOf=2026-05-31').expect(200)).body;
    const row = (code: string) => tb.rows.find((r: TbRow) => r.code === code) as TbRow;
    expect(tb.balanced).toBe(true);
    expect(row('1100')).toMatchObject({ debit: 1250000, credit: 80000, balanceDebit: 1170000, balanceCredit: 0 });
    expect(row('4000')).toMatchObject({ balanceDebit: 0, balanceCredit: 250000 });
    expect(tb.totals).toEqual({ debit: 1330000, credit: 1330000, balanceDebit: 1250000, balanceCredit: 1250000 });

    const april = (await as('viewer').get('/reports/trial-balance?asOf=2026-04-30').expect(200)).body;
    expect(april.rows.find((r: TbRow) => r.code === '5300')).toMatchObject({ debit: 0, credit: 0 });
    expect(april.totals.debit).toBe(1000000);
  });

  it("the ledger carries the opening balance and runs it on the account's normal side", async () => {
    const bank = (await as('viewer').get(`/reports/ledger?accountId=${acc.bank}&from=2026-05-01&to=2026-05-31`).expect(200)).body;
    expect(bank.openingBalance).toBe(1000000);
    expect(bank.rows.map((r: { memo: string; balance: number; number: string }) => [r.memo, r.balance])).toEqual([
      ['Sale', 1250000],
      ['Rent', 1170000],
    ]);
    expect(bank.rows[0].number).toBe('JV/2026-27/0002');
    expect(bank.closingBalance).toBe(1170000);
    // Income grows with credits, so its balance shows as positive
    const sales = (await as('viewer').get(`/reports/ledger?accountId=${acc.sales}&from=2026-04-01&to=2026-05-31`).expect(200)).body;
    expect(sales.closingBalance).toBe(250000);
    await as('viewer').get(`/reports/ledger?accountId=${acc.bank}&from=2026-05-31&to=2026-05-01`).expect(400);
  });

  it('exports CSV for those allowed to export', async () => {
    await as('viewer').get('/reports/trial-balance/export?asOf=2026-05-31').expect(403);
    const csv = await as('owner').get('/reports/trial-balance/export?asOf=2026-05-31').expect(200);
    expect(csv.headers['content-disposition']).toContain('trial-balance-2026-05-31.csv');
    expect(csv.text).toContain('"1100"');
    expect(csv.text).toContain('"11700.00"');
    expect(csv.text).toMatch(/"Total","","13300\.00","13300\.00"/);
    const ledger = await as('owner').get(`/reports/ledger/export?accountId=${acc.bank}&from=2026-05-01&to=2026-05-31`).expect(200);
    expect(ledger.text).toContain('"Opening balance"');
  });

  it("other organisations see none of it", async () => {
    const b = (await as('ownerB', orgB).get('/reports/trial-balance?asOf=2026-05-31').expect(200)).body;
    expect(b.totals.debit).toBe(0);
    await as('ownerB', orgB).get(`/reports/ledger?accountId=${acc.bank}&from=2026-05-01&to=2026-05-31`).expect(404);
  });

  it('stays fast with 100,000 posted lines', async () => {
    // One entry with 100,000 lines, written straight to the database for speed, then posted (the trigger checks the balance)
    const year = await prisma.fiscalYear.findFirstOrThrow({ where: { organizationId: orgA } });
    const entry = await prisma.journalEntry.create({ data: { organizationId: orgA, date: new Date('2026-06-15'), memo: 'Bulk' } });
    await prisma.$executeRaw`
      INSERT INTO journal_lines (id, organization_id, entry_id, line_no, account_id, debit, credit)
      SELECT gen_random_uuid(), ${orgA}::uuid, ${entry.id}::uuid, g,
             CASE WHEN g % 2 = 0 THEN ${acc.rent}::uuid ELSE ${acc.bank}::uuid END,
             CASE WHEN g % 2 = 0 THEN 100 ELSE 0 END, CASE WHEN g % 2 = 0 THEN 0 ELSE 100 END
      FROM generate_series(1, 100000) g`;
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'posted', number: 999, fiscalYearId: year.id, postedAt: new Date() } });

    const started = Date.now();
    const tb = (await as('viewer').get('/reports/trial-balance?asOf=2026-06-30').expect(200)).body;
    const tbMs = Date.now() - started;
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r: TbRow) => r.code === '5300').debit).toBe(80000 + 50000 * 100);
    expect(tbMs).toBeLessThan(2000);

    const ledgerStarted = Date.now();
    const rent = (await as('viewer').get(`/reports/ledger?accountId=${acc.rent}&from=2026-06-01&to=2026-06-30`).expect(200)).body;
    expect(rent.rows).toHaveLength(50000);
    expect(rent.closingBalance).toBe(80000 + 50000 * 100);
    expect(Date.now() - ledgerStarted).toBeLessThan(5000);
  }, 60_000);
});
