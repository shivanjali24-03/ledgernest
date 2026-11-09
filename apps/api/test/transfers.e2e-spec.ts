import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Entry = {
  lines: {
    account: { code: string };
    debit: number;
    credit: number;
    foreignDebit: number;
    foreignCredit: number;
  }[];
};
type Tx = {
  id: string;
  kind: string;
  status: string;
  amount: number;
  toAmount: number | null;
  rate: string | null;
  journalEntry: { id: string };
};

describe('Banking: transfers between accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let toCash: Tx;

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
    };
  };
  const transfer = (body: object, status = 201) =>
    as()
      .post('/banking/transfers', { date: '2026-05-12', ...body })
      .expect(status);
  const lines = async (t: Tx) =>
    (
      (await as().get(`/journals/${t.journalEntry.id}`).expect(200))
        .body as Entry
    ).lines.map((l) => [
      l.account.code,
      l.debit,
      l.credit,
      l.foreignDebit || l.foreignCredit,
    ]);

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
          name: `Transfers ${run}`,
          slug: `transfers-${run}`,
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
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await as()
      .put('/currencies/USD/rates/2026-05-01', { rate: '90' })
      .expect(200);
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'usdBank',
        { code: '1150', type: 'asset', subtype: 'bank', currency: 'USD' },
      ],
      ['cash', { code: '1200', type: 'asset', subtype: 'cash' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('moves money from the bank to petty cash', async () => {
    toCash = (
      await transfer({
        fromAccountId: acc.bank,
        toAccountId: acc.cash,
        amount: 1_000_000,
        reference: 'CHQ 000412',
      })
    ).body;
    expect(toCash).toMatchObject({
      kind: 'transfer',
      amount: 1_000_000,
      toAmount: 1_000_000,
      rate: null,
    });
    expect(await lines(toCash)).toEqual([
      ['1200', 1_000_000, 0, 0],
      ['1100', 0, 1_000_000, 0],
    ]);
  });

  it('buys dollars: each side at its own rate, the difference a loss', async () => {
    // ₹93,000 bought USD 1,000, which the books carry at 90: ₹3,000 lost to the spread
    const t = (
      await transfer({
        fromAccountId: acc.bank,
        toAccountId: acc.usdBank,
        amount: 9_300_000,
        toAmount: 100_000,
      })
    ).body as Tx;
    expect(t.rate).toBe('93');
    expect(await lines(t)).toEqual([
      ['1150', 9_000_000, 0, 100_000],
      ['1100', 0, 9_300_000, 0],
      ['4950', 300_000, 0, 0],
    ]);
  });

  it('sells dollars at more than the books carry them: a gain', async () => {
    const t = (
      await transfer({
        fromAccountId: acc.usdBank,
        toAccountId: acc.bank,
        amount: 10_000,
        toAmount: 915_000,
      })
    ).body as Tx;
    expect(await lines(t)).toEqual([
      ['1100', 915_000, 0, 0],
      ['1150', 0, 900_000, 10_000],
      ['4950', 0, 15_000, 0],
    ]);
  });

  it('needs what arrived between currencies, and only that within one', async () => {
    expect(
      (
        await transfer(
          { fromAccountId: acc.bank, toAccountId: acc.usdBank, amount: 100 },
          400,
        )
      ).body.details.reason,
    ).toBe('to_amount_required');
    expect(
      (
        await transfer(
          {
            fromAccountId: acc.bank,
            toAccountId: acc.cash,
            amount: 100,
            toAmount: 99,
          },
          400,
        )
      ).body.details.reason,
    ).toBe('to_amount_differs');
    await transfer(
      { fromAccountId: acc.bank, toAccountId: acc.bank, amount: 100 },
      400,
    );
  });

  it('lists a transfer on both accounts, and voids it', async () => {
    const onCash = (
      await as()
        .get(`/banking/transactions?bankAccountId=${acc.cash}`)
        .expect(200)
    ).body as { items: Tx[] };
    expect(onCash.items.map((t) => t.id)).toEqual([toCash.id]);
    expect(
      (
        await as()
          .get(`/banking/transactions?bankAccountId=${acc.bank}&kind=transfer`)
          .expect(200)
      ).body.total,
    ).toBe(3);
    expect(
      (
        await as()
          .post(`/banking/transactions/${toCash.id}/void`, {})
          .expect(200)
      ).body.status,
    ).toBe('void');
    const cash = (
      (await as().get('/banking/accounts').expect(200)).body as {
        code: string;
        balance: number;
      }[]
    ).find((a) => a.code === '1200')!;
    expect(cash.balance).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, action: 'org.banking.transfer' },
      }),
    ).toBe(3);
  });
});
