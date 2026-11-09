import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Period = { id: string; number: number; canClose: boolean; canReopen: boolean; status: string };
type Year = { id: string; name: string; closed: boolean; closingEntry: { id: string; number: string } | null; periods: Period[] };

describe('Year-end close (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return { get: (p: string) => auth(http().get(`/api/v1${p}`)), post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body) };
  };
  const postEntry = async (date: string, lines: [string, number, number][], memo = 'Test') => {
    const d = await as('owner').post('/journals', { date, memo, lines: lines.map(([a, debit, credit]) => ({ accountId: acc[a], debit, credit })) }).expect(201);
    return (await as('owner').post(`/journals/${d.body.id}/post`).expect(200)).body as { id: string; number: string };
  };
  const years = async () => (await as('owner').get('/fiscal-years').expect(200)).body.years as Year[];
  const year = async (name: string) => (await years()).find((y) => y.name === name)!;
  const closeThrough = async (name: string, upTo: number) => {
    for (const p of (await year(name)).periods.filter((x) => x.number <= upTo && x.status === 'open')) await as('owner').post(`/fiscal-years/periods/${p.id}/close`, {}).expect(204);
  };
  const balance = async (code: string, asOf: string) => {
    const tb = (await as('owner').get(`/reports/trial-balance?asOf=${asOf}`).expect(200)).body as { rows: { code: string; balanceDebit: number; balanceCredit: number }[] };
    const r = tb.rows.find((x) => x.code === code)!;
    return r.balanceDebit - r.balanceCredit;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (await prisma.organization.create({ data: { name: `Year end ${run}`, slug: `year-end-${run}`, fiscalYearStartMonth: 4 } })).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['bookkeeper', 'bookkeeper'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    for (const [key, code, type, subtype, systemKey] of [
      ['bank', '1100', 'asset', 'bank', null],
      ['capital', '3100', 'equity', 'owner_equity', null],
      ['retained', '3900', 'equity', 'retained_earnings', 'retained_earnings'],
      ['sales', '4000', 'income', 'operating_income', null],
      ['interest', '4800', 'income', 'other_income', null],
      ['rent', '5300', 'expense', 'operating_expense', null],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: org, code, name: `${key} ${run}`, type, subtype, systemKey } })).id;
    }
    await as('owner').post('/fiscal-years', { startYear: 2025 }).expect(201);
    await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(201);
    await postEntry('2025-04-01', [['bank', 1_000_000, 0], ['capital', 0, 1_000_000]], 'Capital');
    await postEntry('2025-06-15', [['bank', 800_000, 0], ['sales', 0, 800_000]], 'Sales');
    await postEntry('2025-09-30', [['bank', 5_000, 0], ['interest', 0, 5_000]], 'Interest');
    await postEntry('2026-01-31', [['rent', 300_000, 0], ['bank', 0, 300_000]], 'Rent');
    // Next year's sale stays in next year
    await postEntry('2026-04-10', [['bank', 100_000, 0], ['sales', 0, 100_000]], 'Next year sale');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('previews the profit closing the year will move', async () => {
    const y = await year('FY 2025–26');
    expect((await as('bookkeeper').get(`/fiscal-years/${y.id}/year-end`).expect(200)).body).toEqual({ name: 'FY 2025–26', profit: 505_000, accounts: 3 });
  });

  it("closing the year's last month moves every income and expense balance to retained earnings", async () => {
    await closeThrough('FY 2025–26', 11);
    expect((await year('FY 2025–26')).closingEntry).toBeNull();
    await closeThrough('FY 2025–26', 12);
    const y = await year('FY 2025–26');
    expect(y.closed).toBe(true);
    expect(y.closingEntry?.number).toBe('JV/2025-26/0005');

    const entry = (await as('owner').get(`/journals/${y.closingEntry!.id}`).expect(200)).body as { date: string; memo: string; lines: { account: { code: string }; debit: number; credit: number }[] };
    expect(entry.date).toBe('2026-03-31');
    expect(entry.memo).toBe('Year-end close FY 2025–26');
    const byCode = (a: (string | number)[], b: (string | number)[]) => String(a[0]).localeCompare(String(b[0]));
    expect(entry.lines.map((l) => [l.account.code, l.debit, l.credit]).sort(byCode)).toEqual([
      ['3900', 0, 505_000],
      ['4000', 800_000, 0],
      ['4800', 5_000, 0],
      ['5300', 0, 300_000],
    ]);
    // At year end income and expenses are zero and the profit sits in retained earnings
    expect(await balance('4000', '2026-03-31')).toBe(0);
    expect(await balance('5300', '2026-03-31')).toBe(0);
    expect(await balance('3900', '2026-03-31')).toBe(-505_000);
    // Next year's income is untouched
    expect(await balance('4000', '2026-04-30')).toBe(-100_000);
    expect(await prisma.auditLog.count({ where: { organizationId: org, action: 'org.fiscal_year.close' } })).toBe(1);
  });

  it("the closing entry can't be reversed by hand", async () => {
    const y = await year('FY 2025–26');
    const r = await as('owner').post(`/journals/${y.closingEntry!.id}/reverse`, { date: '2026-04-30' }).expect(409);
    expect(r.body.details.reason).toBe('closing_entry');
  });

  it('reopening the last month reverses the close, and closing again moves the corrected profit', async () => {
    const y = await year('FY 2025–26');
    const first = y.closingEntry!;
    await as('owner').post(`/fiscal-years/periods/${y.periods[11]!.id}/reopen`, { reason: 'Missed a bill' }).expect(204);
    const reopened = await year('FY 2025–26');
    expect(reopened.closingEntry).toBeNull();
    const original = (await as('owner').get(`/journals/${first.id}`).expect(200)).body;
    expect(original.reversedBy.number).toBe('JV/2025-26/0006');
    expect(await balance('3900', '2026-03-31')).toBe(0);
    expect(await balance('4000', '2026-03-31')).toBe(-800_000);

    await postEntry('2026-03-20', [['rent', 5_000, 0], ['bank', 0, 5_000]], 'Late bill');
    await as('owner').post(`/fiscal-years/periods/${reopened.periods[11]!.id}/close`, {}).expect(204);
    const again = await year('FY 2025–26');
    expect(again.closingEntry!.number).toBe('JV/2025-26/0008');
    expect(await balance('3900', '2026-03-31')).toBe(-500_000);
    expect(await prisma.auditLog.count({ where: { organizationId: org, action: 'org.fiscal_year.reopen' } })).toBe(1);
  });

  it('a year with no income or expenses closes without an entry, and a loss is debited to retained earnings', async () => {
    // Next year: a month with only a loss so far, closed through to the end
    await postEntry('2026-05-05', [['rent', 900_000, 0], ['bank', 0, 900_000]], 'Big rent');
    const preview = (await as('owner').get(`/fiscal-years/${(await year('FY 2026–27')).id}/year-end`).expect(200)).body;
    expect(preview.profit).toBe(100_000 - 900_000);
    await closeThrough('FY 2026–27', 12);
    const y = await year('FY 2026–27');
    const entry = (await as('owner').get(`/journals/${y.closingEntry!.id}`).expect(200)).body as { lines: { account: { code: string }; debit: number; credit: number }[] };
    expect(entry.lines.find((l) => l.account.code === '3900')).toMatchObject({ debit: 800_000, credit: 0 });

    // A fresh organisation-like case: an empty year closes with no entry
    await as('owner').post('/fiscal-years', { startYear: 2027 }).expect(201);
    await closeThrough('FY 2027–28', 12);
    expect((await year('FY 2027–28')).closingEntry).toBeNull();
  });
});
