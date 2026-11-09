import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Workspace = {
  bankLines: {
    id: string;
    date: string;
    amount: number;
    description: string;
  }[];
  bookLines: { id: string; entryId: string; date: string; amount: number }[];
  suggestions: {
    statementLineId: string;
    journalLineIds: string[];
    confidence: string;
  }[];
  matched: { id: string }[];
  summary: {
    bookBalance: number;
    outstandingIn: number;
    outstandingOut: number;
    cleared: number;
    since: string | null;
    unmatchedToDate: number;
    statementBalance: number | null;
  };
};

// May's statement: interest in, a card payment out, and bank charges the books don't have yet
const MAY = [
  'Date,Narration,Ref,Withdrawal,Deposit,Balance',
  '02/05/26,INTEREST CREDIT,,,"1,000.00","11,000.00"',
  '05/05/26,POS SHARMA OFFICE SUPPLIES,881,590.00,,"10,410.00"',
  '15/05/26,CHARGES INCL GST,,118.00,,"10,292.00"',
].join('\n');

describe('Banking: reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const tx: Record<string, { id: string; journalEntry: { id: string } }> = {};
  let org = '';
  let gst18 = '';
  let ws: Workspace;
  let rec = '';

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
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const money = async (
    kind: string,
    date: string,
    amount: number,
    account: string,
    extra: object = {},
  ) =>
    (
      await as()
        .post('/banking/money', {
          kind,
          bankAccountId: acc.bank,
          date,
          lines: [{ accountId: account, amount }],
          ...extra,
        })
        .expect(201)
    ).body;
  const workspace = async (date = '2026-05-31', who = 'owner') =>
    (ws = (
      await as(who)
        .get(`/banking/reconcile/${acc.bank}?date=${date}`)
        .expect(200)
    ).body);

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
          name: `Reconcile ${run}`,
          slug: `reconcile-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
      ['other', { code: '1110', type: 'asset', subtype: 'bank' }],
      ['capital', { code: '3000', type: 'equity', subtype: 'owner_equity' }],
      ['interest', { code: '4500', type: 'income', subtype: 'other_income' }],
      [
        'supplies',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
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
    // Before the bank's record starts: taken as already through the bank
    await money('receive', '2026-04-15', 1_000_000, acc.capital);
    tx.interest = await money('receive', '2026-05-02', 100_000, acc.interest);
    tx.supplies = await money('spend', '2026-05-04', 59_000, acc.supplies);
    // A cheque not yet presented, and a deposit not yet credited
    tx.cheque = await money('spend', '2026-05-28', 200_000, acc.supplies, {
      reference: 'CHQ 000413',
    });
    tx.deposit = await money('receive', '2026-05-30', 500_000, acc.capital);
    await as()
      .post('/banking/statements/import', {
        bankAccountId: acc.bank,
        fileName: 'may.csv',
        content: MAY,
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

  it('lays out what to reconcile, suggesting the obvious matches', async () => {
    await workspace('2026-05-31', 'auditor');
    expect(ws.bankLines.map((l) => [l.date, l.amount])).toEqual([
      ['2026-05-02', 100_000],
      ['2026-05-05', -59_000],
      ['2026-05-15', -11_800],
    ]);
    expect(ws.bookLines.map((l) => l.amount)).toEqual([
      1_000_000, 100_000, -59_000, -200_000, 500_000,
    ]);
    expect(
      ws.suggestions.map((s) => [
        ws.bankLines.find((b) => b.id === s.statementLineId)!.amount,
        ws.bookLines.find((b) => b.id === s.journalLineIds[0])!.date,
      ]),
    ).toEqual([
      [100_000, '2026-05-02'],
      [-59_000, '2026-05-04'],
    ]);
    // Nothing matched yet, so everything since the bank's record began is outstanding: only the ₹10,000 before it is cleared
    expect(ws.summary).toMatchObject({
      bookBalance: 1_341_000,
      outstandingIn: 600_000,
      outstandingOut: 259_000,
      cleared: 1_000_000,
      since: '2026-05-02',
      unmatchedToDate: 3,
      statementBalance: 1_029_200,
    });
    await as('auditor')
      .post('/banking/reconcile/match', ws.suggestions[0]!)
      .expect(403);
  });

  it('matches book lines that add up to the bank line, and nothing else', async () => {
    const [interest, supplies] = ws.suggestions;
    expect(
      (
        await as()
          .post('/banking/reconcile/match', {
            statementLineId: interest!.statementLineId,
            journalLineIds: supplies!.journalLineIds,
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('amounts_differ');
    await as().post('/banking/reconcile/match', interest!).expect(204);
    await as().post('/banking/reconcile/match', supplies!).expect(204);
    expect(
      (await as().post('/banking/reconcile/match', supplies!).expect(409)).body
        .details.reason,
    ).toBe('line_not_unmatched');
    await workspace();
    expect(ws.matched).toHaveLength(2);
    expect(ws.bankLines).toHaveLength(1);
    // Books ₹14,410; ₹5,000 not yet in the bank and ₹2,000 not yet out: ₹11,410 cleared
    expect(ws.summary).toMatchObject({
      outstandingIn: 500_000,
      outstandingOut: 200_000,
      cleared: 1_041_000,
    });
    // A matched entry stands: the bank says it happened
    expect(
      (
        await as()
          .post(`/banking/transactions/${tx.interest!.id}/void`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('bank_matched');
  });

  it('records what the books are missing straight from the bank line, tax included, and matches it', async () => {
    expect(
      (
        await as()
          .post('/banking/reconciliations', {
            bankAccountId: acc.bank,
            statementDate: '2026-05-31',
            statementBalance: 1_029_200,
          })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'unmatched_lines', count: 1 });
    const created = (
      await as()
        .post('/banking/reconcile/create', {
          statementLineId: ws.bankLines[0]!.id,
          accountId: acc.charges,
          taxGroupId: gst18,
          description: 'Bank charges, May',
        })
        .expect(201)
    ).body;
    const e = (
      await as().get(`/journals/${created.journalEntry.id}`).expect(200)
    ).body as {
      lines: { account: { code: string }; debit: number; credit: number }[];
    };
    expect(e.lines.map((l) => [l.debit, l.credit])).toEqual([
      [10_000, 0],
      [900, 0],
      [900, 0],
      [0, 11_800],
    ]);
    await workspace();
    expect(ws.bankLines).toHaveLength(0);
    expect(ws.summary).toMatchObject({
      bookBalance: 1_329_200,
      cleared: 1_029_200,
      unmatchedToDate: 0,
    });
  });

  it('reconciles when the books agree with the statement, and locks what it covered', async () => {
    expect(
      (
        await as()
          .post('/banking/reconciliations', {
            bankAccountId: acc.bank,
            statementDate: '2026-05-31',
            statementBalance: 1_030_000,
          })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'difference', difference: 800 });
    const r = (
      await as()
        .post('/banking/reconciliations', {
          bankAccountId: acc.bank,
          statementDate: '2026-05-31',
          statementBalance: 1_029_200,
        })
        .expect(201)
    ).body;
    rec = r.id;
    expect(r).toMatchObject({
      statementDate: '2026-05-31',
      statementBalance: 1_029_200,
      bookBalance: 1_329_200,
      outstandingIn: 500_000,
      outstandingOut: 200_000,
      matches: 3,
    });
    const line = (
      await as()
        .get(
          `/banking/statements/lines?bankAccountId=${acc.bank}&status=matched`,
        )
        .expect(200)
    ).body.items[0];
    expect(
      (await as().post(`/banking/reconcile/unmatch/${line.id}`).expect(409))
        .body.details.reason,
    ).toBe('reconciled');
    expect(
      (
        await as()
          .post('/banking/reconciliations', {
            bankAccountId: acc.bank,
            statementDate: '2026-05-20',
            statementBalance: 0,
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('before_last');
    expect(
      (
        await as('auditor')
          .get(`/banking/reconciliations?bankAccountId=${acc.bank}`)
          .expect(200)
      ).body,
    ).toHaveLength(1);
  });

  it('undoes the latest reconciliation, then lines can be unmatched and set aside', async () => {
    await as().delete(`/banking/reconciliations/${rec}`).expect(204);
    const line = (
      await as()
        .get(
          `/banking/statements/lines?bankAccountId=${acc.bank}&status=matched`,
        )
        .expect(200)
    ).body.items[0];
    await as().post(`/banking/reconcile/unmatch/${line.id}`).expect(204);
    await as()
      .post('/banking/reconcile/ignore', {
        statementLineId: line.id,
        ignored: true,
      })
      .expect(204);
    await workspace();
    expect(ws.bankLines.some((l) => l.id === line.id)).toBe(false);
    await as()
      .post('/banking/reconcile/ignore', {
        statementLineId: line.id,
        ignored: false,
      })
      .expect(204);
    await workspace();
    expect(ws.bankLines.some((l) => l.id === line.id)).toBe(true);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.banking.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.banking.match',
        'org.banking.unmatch',
        'org.banking.ignore',
        'org.banking.unignore',
        'org.banking.reconcile',
        'org.banking.reconcile_undo',
      ]),
    );
  });
});
