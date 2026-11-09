import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Line = { lineNo: number; account: { code: string }; debit: number; credit: number; currency: string | null; foreignDebit: number; foreignCredit: number; rate: string | null; fxSourceLine: number | null };
type Entry = { id: string; number: string; lines: Line[]; totals: { difference: number } };

describe('Foreign-currency lines and exchange differences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) => auth(http().put(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  type L = { a: string; dr?: number; cr?: number; fdr?: number; fcr?: number; ccy?: string; rate?: string };
  const lines = (ls: L[]) => ls.map((l) => ({ accountId: acc[l.a], debit: l.dr ?? 0, credit: l.cr ?? 0, ...(l.ccy && { currency: l.ccy, foreignDebit: l.fdr ?? 0, foreignCredit: l.fcr ?? 0, ...(l.rate && { rate: l.rate }) }) }));
  const post = async (date: string, ls: L[], memo = 'Test') => {
    const d = await as().post('/journals', { date, memo, lines: lines(ls) }).expect(201);
    return (await as().post(`/journals/${d.body.id}/post`).expect(200)).body as Entry;
  };
  const shape = (e: Entry) => e.lines.map((l) => [l.account.code, l.debit, l.credit, l.currency, l.foreignDebit || l.foreignCredit || 0, l.fxSourceLine]);
  const balance = async (code: string, asOf: string) => {
    const r = ((await as().get(`/reports/trial-balance?asOf=${asOf}`).expect(200)).body.rows as { code: string; balanceDebit: number; balanceCredit: number }[]).find((x) => x.code === code);
    return r ? r.balanceDebit - r.balanceCredit : 0;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (await prisma.organization.create({ data: { name: `Foreign ${run}`, slug: `foreign-${run}`, baseCurrency: 'INR', fiscalYearStartMonth: 4 } })).id;
    const u = await prisma.user.create({ data: { email: `owner-${run}@test.ledgernest.local`, name: 'Owner', passwordHash: 'unused' } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: 'owner' } });
    users.owner = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    await as().post('/currencies', { code: 'USD' }).expect(201);
    for (const [date, rate] of [
      ['2026-05-01', '90'],
      ['2026-05-20', '93'],
      ['2026-05-31', '95'],
      ['2026-06-10', '92'],
    ]) {
      await as().put(`/currencies/USD/rates/${date}`, { rate }).expect(200);
    }
    for (const [key, code, type, subtype, currency] of [
      ['bank', '1100', 'asset', 'bank', null],
      ['usdBank', '1150', 'asset', 'bank', 'USD'],
      ['usdDebtors', '1210', 'asset', 'accounts_receivable', 'USD'],
      ['sales', '4000', 'income', 'operating_income', null],
    ] as const) {
      acc[key] = (await as().post('/accounts', { code, name: `${key} ${run}`, type, subtype, ...(currency && { currency }) }).expect(201)).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('keeps foreign accounts to assets and liabilities in an enabled currency', async () => {
    expect((await as().post('/accounts', { code: '4100', name: `x ${run}`, type: 'income', subtype: 'operating_income', currency: 'USD' }).expect(400)).body.details.reason ?? 'schema').toBeTruthy();
    expect((await as().post('/accounts', { code: '1160', name: `eur ${run}`, type: 'asset', subtype: 'bank', currency: 'EUR' }).expect(400)).body.details.reason).toBe('currency_not_enabled');
  });

  it('converts an invoice in USD at the day’s rate, keeping both amounts', async () => {
    const e = await post('2026-05-05', [{ a: 'usdDebtors', ccy: 'USD', fdr: 100_000 }, { a: 'sales', cr: 9_000_000 }], 'Invoice to Acme Inc.');
    expect(shape(e)).toEqual([
      ['1210', 9_000_000, 0, 'USD', 100_000, null],
      ['4000', 0, 9_000_000, null, 0, null],
    ]);
    expect(e.lines[0]!.rate).toBe('90');
  });

  it('refuses lines that mix up currencies, or have no rate', async () => {
    const reason = async (date: string, ls: L[]) => (await as().post('/journals', { date, lines: lines(ls) }).expect(400)).body.details.reason;
    expect(await reason('2026-05-06', [{ a: 'usdDebtors', dr: 100 }, { a: 'sales', cr: 100 }])).toBe('currency_required');
    expect(await reason('2026-05-06', [{ a: 'bank', ccy: 'USD', fdr: 100 }, { a: 'sales', cr: 100 }])).toBe('currency_mismatch');
    expect(await reason('2026-04-10', [{ a: 'usdDebtors', ccy: 'USD', fdr: 100 }, { a: 'sales', cr: 9_000 }])).toBe('no_rate');
    // A rate typed on the line wins over the day's rate
    const d = (await as().post('/journals', { date: '2026-04-10', lines: lines([{ a: 'usdDebtors', ccy: 'USD', fdr: 100, rate: '88.5' }, { a: 'sales', cr: 8_850 }]) }).expect(201)).body as Entry;
    expect(d.lines[0]!.debit).toBe(8_850);
    await as().delete(`/journals/${d.id}`).expect(204);
  });

  it('realises the exchange gain on the part of a receivable that is collected', async () => {
    const e = await post('2026-05-20', [{ a: 'usdBank', ccy: 'USD', fdr: 40_000 }, { a: 'usdDebtors', ccy: 'USD', fcr: 40_000 }], 'Part payment from Acme');
    // USD 400 booked at 90 is collected at 93: ₹1,200 gained
    expect(shape(e)).toEqual([
      ['1150', 3_720_000, 0, 'USD', 40_000, null],
      ['1210', 0, 3_720_000, 'USD', 40_000, null],
      ['1210', 120_000, 0, 'USD', 0, 2],
      ['4950', 0, 120_000, null, 0, 2],
    ]);
    expect(e.totals.difference).toBe(0);
    expect(await balance('1210', '2026-05-20')).toBe(5_400_000); // USD 600 still at 90
  });

  it('revalues foreign balances at the month-end rate, booking the unrealised difference', async () => {
    const r = (await as().post('/currencies/revalue', { date: '2026-05-31' }).expect(200)).body;
    expect(r.adjustments.map((x: { code: string; foreignBalance: number; before: number; after: number; difference: number }) => [x.code, x.foreignBalance, x.before, x.after, x.difference])).toEqual([
      ['1150', 40_000, 3_720_000, 3_800_000, 80_000],
      ['1210', 60_000, 5_400_000, 5_700_000, 300_000],
    ]);
    const e = (await as().get(`/journals/${r.entry.id}`).expect(200)).body as Entry;
    expect(e.lines.filter((l) => l.account.code === '4960').reduce((s, l) => s + l.credit, 0)).toBe(380_000);
    expect(await balance('4960', '2026-05-31')).toBe(-380_000);
    // Nothing more to do at the same rate
    expect((await as().post('/currencies/revalue', { date: '2026-05-31' }).expect(200)).body).toMatchObject({ entry: null, adjustments: [] });
  });

  it('settling the rest realises the difference from the revalued amount, leaving nothing behind', async () => {
    const e = await post('2026-06-10', [{ a: 'usdBank', ccy: 'USD', fdr: 60_000 }, { a: 'usdDebtors', ccy: 'USD', fcr: 60_000 }], 'Final payment from Acme');
    // USD 600 carried at 95 after revaluation, collected at 92: ₹1,800 lost
    expect(shape(e).slice(2)).toEqual([
      ['1210', 0, 180_000, 'USD', 0, 2],
      ['4950', 180_000, 0, null, 0, 2],
    ]);
    expect(await balance('1210', '2026-06-10')).toBe(0);
    const ledger = (await as().get(`/reports/ledger?accountId=${acc.usdDebtors}&from=2026-05-01&to=2026-06-30`).expect(200)).body;
    expect(ledger.foreign).toEqual({ currency: 'USD', openingBalance: 0, closingBalance: 0 });
    expect(ledger.rows[0]).toMatchObject({ foreignDebit: 100_000, rate: '90', foreignBalance: 100_000 });
  });

  it('a reversal mirrors the exchange lines instead of working them out again', async () => {
    const original = (await as().get('/journals?status=posted&search=Final').expect(200)).body.items[0];
    const full = (await as().get(`/journals/${original.id}`).expect(200)).body as Entry;
    const rev = (await as().post(`/journals/${original.id}/reverse`, { date: '2026-06-11' }).expect(201)).body as Entry;
    expect(shape(rev)).toEqual(shape(full).map(([c, d, cr, ccy, f, src]) => [c, cr, d, ccy, f, src]));
    expect(await balance('1210', '2026-06-11')).toBe(5_700_000);
  });

  it('a currency or an account currency in use stays put', async () => {
    expect((await as().delete('/currencies/USD').expect(409)).body.details.reason).toBe('in_use');
    expect((await as().patch(`/accounts/${acc.usdDebtors}`, { currency: null }).expect(409)).body.details.reason).toBe('has_entries');
  });

  it('the database refuses a foreign line whose currency isn’t its account’s', async () => {
    const d = (await as().post('/journals', { date: '2026-06-12', lines: lines([{ a: 'bank', dr: 1 }]) }).expect(201)).body as Entry;
    await prisma.organizationCurrency.create({ data: { organizationId: org, code: 'EUR' } });
    await expect(prisma.$executeRaw`
      INSERT INTO journal_lines (id, organization_id, entry_id, line_no, account_id, debit, credit, currency, foreign_debit, rate)
      VALUES (gen_random_uuid(), ${org}::uuid, ${d.id}::uuid, 9, ${acc.usdBank}::uuid, 1, 0, 'EUR', 1, 1)`).rejects.toThrow(/journal_lines_organization_id_account_id_currency_fkey|foreign key/);
  });
});
