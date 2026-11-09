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
    account: { code: string; name: string };
    debit: number;
    credit: number;
    currency: string | null;
    foreignCredit: number;
  }[];
};
type Tx = {
  id: string;
  kind: string;
  status: string;
  amount: number;
  currency: string | null;
  journalEntry: { id: string };
};
type Bank = {
  id: string;
  code: string;
  balance: number;
  foreignBalance: number | null;
  recentMovements: number;
  lastActivity: string | null;
};

describe('Banking: accounts and money in and out (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const tx: Record<string, Tx> = {};
  let org = '';
  let gst18 = '';

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
  const money = (body: object, status = 201) =>
    as().post('/banking/money', body).expect(status);
  const entry = async (id: string) =>
    (await as().get(`/journals/${id}`).expect(200)).body as Entry;
  const banks = async () =>
    (await as('auditor').get('/banking/accounts').expect(200)).body as Bank[];

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
          name: `Banking ${run}`,
          slug: `banking-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['interest', { code: '4500', type: 'income', subtype: 'other_income' }],
      ['charges', { code: '5900', type: 'expense', subtype: 'other_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('spends money with GST on top: the cost and its input credit against the bank', async () => {
    tx.charges = (
      await money({
        kind: 'spend',
        bankAccountId: acc.bank,
        date: '2026-05-05',
        description: 'Bank charges, April',
        reference: 'HDFC/CHG/04',
        lines: [{ accountId: acc.charges, amount: 50_000, taxGroupId: gst18 }],
      })
    ).body;
    expect(tx.charges).toMatchObject({
      kind: 'spend',
      amount: 59_000,
      status: 'posted',
    });
    const e = await entry(tx.charges!.journalEntry.id);
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['5900', 50_000, 0],
      [expect.any(String), 4_500, 0],
      [expect.any(String), 4_500, 0],
      ['1100', 0, 59_000],
    ]);
    expect(e.lines.slice(1, 3).map((l) => l.account.name)).toEqual([
      expect.stringMatching(/CGST/),
      expect.stringMatching(/SGST/),
    ]);
  });

  it('spends a tax-inclusive amount, and receives money with no tax', async () => {
    const inclusive = (
      await money({
        kind: 'spend',
        bankAccountId: acc.bank,
        date: '2026-05-06',
        taxInclusive: true,
        lines: [
          {
            accountId: acc.charges,
            amount: 118_000,
            taxGroupId: gst18,
            description: 'Card machine rent',
          },
        ],
      })
    ).body as Tx;
    expect(inclusive.amount).toBe(118_000);
    expect(
      (await entry(inclusive.journalEntry.id)).lines.map((l) => [
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      [100_000, 0],
      [9_000, 0],
      [9_000, 0],
      [0, 118_000],
    ]);
    tx.interest = (
      await money({
        kind: 'receive',
        bankAccountId: acc.bank,
        date: '2026-05-31',
        description: 'Interest, May',
        lines: [{ accountId: acc.interest, amount: 123_456 }],
      })
    ).body;
    expect(
      (await entry(tx.interest!.journalEntry.id)).lines.map((l) => [
        l.account.code,
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      ['1100', 123_456, 0],
      ['4500', 0, 123_456],
    ]);
  });

  it('spends from a USD account at the day’s rate, in dollars', async () => {
    const usd = (
      await money({
        kind: 'spend',
        bankAccountId: acc.usdBank,
        date: '2026-05-10',
        description: 'Wire fee',
        lines: [{ accountId: acc.charges, amount: 2_500 }],
      })
    ).body as Tx;
    expect(usd).toMatchObject({ currency: 'USD', amount: 2_500 });
    expect(
      (await entry(usd.journalEntry.id)).lines.map((l) => [
        l.account.code,
        l.debit,
        l.credit,
        l.currency,
        l.foreignCredit,
      ]),
    ).toEqual([
      ['5900', 225_000, 0, null, 0],
      ['1150', 0, 225_000, 'USD', 2_500],
    ]);
  });

  it('refuses customers and vendors, the same account, other accounts as the bank, tax on dollars, and those who may not', async () => {
    const reason = async (body: object) =>
      (
        await money(
          {
            kind: 'spend',
            bankAccountId: acc.bank,
            date: '2026-05-10',
            lines: [{ accountId: acc.charges, amount: 100 }],
            ...body,
          },
          400,
        )
      ).body.details.reason;
    expect(
      await reason({ lines: [{ accountId: acc.debtors, amount: 100 }] }),
    ).toBe('use_documents');
    expect(
      await reason({ lines: [{ accountId: acc.bank, amount: 100 }] }),
    ).toBe('same_account');
    expect(await reason({ bankAccountId: acc.charges })).toBe('bank_invalid');
    expect(
      await reason({
        bankAccountId: acc.usdBank,
        lines: [{ accountId: acc.charges, amount: 100, taxGroupId: gst18 }],
      }),
    ).toBe('tax_foreign');
    await as('viewer').get('/banking/accounts').expect(403);
    await as('auditor')
      .post('/banking/money', {
        kind: 'spend',
        bankAccountId: acc.bank,
        date: '2026-05-10',
        lines: [{ accountId: acc.charges, amount: 100 }],
      })
      .expect(403);
  });

  it('shows each account’s balance, and what moved through it', async () => {
    const list = await banks();
    expect(list.map((b) => b.code)).toEqual(['1100', '1150', '1200']);
    const bank = list.find((b) => b.code === '1100')!;
    // −₹590 − ₹1,180 + ₹1,234.56
    expect(bank).toMatchObject({
      balance: -53_544,
      foreignBalance: null,
      lastActivity: '2026-05-31',
    });
    expect(list.find((b) => b.code === '1150')!).toMatchObject({
      balance: -225_000,
      foreignBalance: -2_500,
    });
    expect(list.find((b) => b.code === '1200')!).toMatchObject({
      balance: 0,
      lastActivity: null,
    });
    const a = (
      await as('auditor')
        .get(
          `/banking/accounts/${acc.bank}/activity?from=2026-05-01&to=2026-05-31`,
        )
        .expect(200)
    ).body as { rows: unknown[]; closingBalance: number };
    expect(a.rows).toHaveLength(3);
    expect(a.closingBalance).toBe(-53_544);
    expect(
      (
        await as('auditor')
          .get(
            `/banking/accounts/${acc.charges}/activity?from=2026-05-01&to=2026-05-31`,
          )
          .expect(400)
      ).body.details.reason,
    ).toBe('bank_invalid');
    expect(
      (
        await as('auditor')
          .get(`/banking/transactions?bankAccountId=${acc.bank}`)
          .expect(200)
      ).body.total,
    ).toBe(3);
  });

  it('voids a transaction by reversing its entry, never by hand', async () => {
    expect(
      (
        await as()
          .post(`/journals/${tx.charges!.journalEntry.id}/reverse`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('document_entry');
    const v = (
      await as()
        .post(`/banking/transactions/${tx.charges!.id}/void`, {
          reason: 'Refunded by the bank',
        })
        .expect(200)
    ).body as Tx;
    expect(v.status).toBe('void');
    await as()
      .post(`/banking/transactions/${tx.charges!.id}/void`, {})
      .expect(409);
    expect((await banks()).find((b) => b.code === '1100')!.balance).toBe(
      -53_544 + 59_000,
    );
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.banking.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.banking.spend',
        'org.banking.receive',
        'org.banking.void',
      ]),
    );
  });
});
