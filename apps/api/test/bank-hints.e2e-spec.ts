import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Workspace = {
  bankLines: { id: string; description: string; amount: number }[];
  hints: {
    statementLineId: string;
    accountId: string;
    taxGroupId: string | null;
    account: { code: string; name: string };
  }[];
};

// Charges and a card payment in May; the same kinds again in June
const STATEMENT = [
  'Date,Narration,Ref,Withdrawal,Deposit,Balance',
  '15/05/26,CHARGES INCL GST 0525,,118.00,,"9,882.00"',
  '20/05/26,POS SHARMA OFFICE SUPPLIES,881,590.00,,"9,292.00"',
  '15/06/26,CHARGES INCL GST 0625,,236.00,,"9,056.00"',
  '18/06/26,POS SHARMA OFFICE SUPPLIES,912,354.00,,"8,702.00"',
  '25/06/26,NEFT FROM KUMAR LOGISTICS,,,"5,000.00","13,702.00"',
].join('\n');

describe('Banking: hints from earlier lines (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let org = '';
  let token = '';
  let gst18 = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const workspace = async () =>
    (await get(`/banking/reconcile/${acc.bank}?date=2026-06-30`).expect(200))
      .body as Workspace;

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
          name: `Hints ${run}`,
          slug: `hints-${run}`,
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
    token = await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'supplies',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
      ['charges', { code: '5900', type: 'expense', subtype: 'other_expense' }],
    ] as const) {
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    }
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    await post('/banking/statements/import', {
      bankAccountId: acc.bank,
      fileName: 'may-june.csv',
      content: STATEMENT,
    }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('has nothing to suggest before anything was recorded from the statement', async () => {
    expect((await workspace()).hints).toEqual([]);
  });

  it('suggests the account and tax used last time for lines like it', async () => {
    let ws = await workspace();
    const line = (text: string, amount: number) =>
      ws.bankLines.find(
        (l) => l.description.startsWith(text) && l.amount === amount,
      )!;
    // May: charges with GST, and the supplies card payment, recorded from their lines
    await post('/banking/reconcile/create', {
      statementLineId: line('CHARGES', -11_800).id,
      accountId: acc.charges,
      taxGroupId: gst18,
      description: null,
    }).expect(201);
    await post('/banking/reconcile/create', {
      statementLineId: line('POS SHARMA', -59_000).id,
      accountId: acc.supplies,
      taxGroupId: null,
      description: null,
    }).expect(201);
    ws = await workspace();
    const hint = (text: string) =>
      ws.hints.find(
        (h) =>
          h.statementLineId ===
          line(
            text,
            ws.bankLines.find((l) => l.description.startsWith(text))!.amount,
          ).id,
      );
    // June's lines: the same first words (numbers ignored), money going the same way
    expect(hint('CHARGES')).toMatchObject({
      accountId: acc.charges,
      taxGroupId: gst18,
      account: { code: '5900' },
    });
    expect(hint('POS SHARMA')).toMatchObject({
      accountId: acc.supplies,
      taxGroupId: null,
    });
    // Nothing like the incoming NEFT was recorded before
    expect(hint('NEFT')).toBeUndefined();
    expect(ws.hints).toHaveLength(2);
  });
});
