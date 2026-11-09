import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const HDFC = [
  'HDFC BANK Ltd.,,,,,,',
  'Statement of account,,,,,,',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '04/05/26,UPI-SHARMA OFFICE SUPPLIES,000412,04/05/26,"5,900.00",,"2,10,100.00"',
  '06/05/26,NEFT CR-KUMAR LOGISTICS,UTR402918,06/05/26,,"1,18,000.00","3,28,100.00"',
  '06/05/26,NEFT CR-KUMAR LOGISTICS,UTR402918,06/05/26,,"1,18,000.00","4,46,100.00"',
];

describe('Banking: statement import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let firstImport = '';

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
  const body = (content: string, extra: object = {}) => ({
    bankAccountId: acc.bank,
    fileName: 'hdfc-may.csv',
    content,
    ...extra,
  });

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
          slug: `statements-${run}`,
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
    await as().post('/currencies', { code: 'USD' }).expect(201);
    acc.bank = (
      await as()
        .post('/accounts', {
          code: '1100',
          name: `HDFC ${run}`,
          type: 'asset',
          subtype: 'bank',
        })
        .expect(201)
    ).body.id;
    acc.usd = (
      await as()
        .post('/accounts', {
          code: '1150',
          name: `Wise USD ${run}`,
          type: 'asset',
          subtype: 'bank',
          currency: 'USD',
        })
        .expect(201)
    ).body.id;
    acc.sales = (
      await as()
        .post('/accounts', {
          code: '4100',
          name: `Sales ${run}`,
          type: 'income',
          subtype: 'operating_income',
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('previews an Indian bank’s CSV: its layout worked out, its lines read, nothing saved', async () => {
    const p = (
      await as()
        .post('/banking/statements/preview', body(HDFC.join('\n')))
        .expect(200)
    ).body;
    expect(p).toMatchObject({
      format: 'csv',
      total: 3,
      duplicates: 0,
      moneyIn: 23_600_000,
      moneyOut: 590_000,
      firstDate: '2026-05-04',
      lastDate: '2026-05-06',
      issues: [],
    });
    expect(p.mapping).toMatchObject({
      headerRows: 3,
      date: 0,
      moneyOut: 4,
      moneyIn: 5,
    });
    expect(p.headers[1]).toBe('Narration');
    expect(p.lines.map((l: { amount: number }) => l.amount)).toEqual([
      -590_000, 11_800_000, 11_800_000,
    ]);
    expect(
      await prisma.bankStatementLine.count({ where: { organizationId: org } }),
    ).toBe(0);
  });

  it('imports it once: the same file again, or an overlapping one, adds only what is new', async () => {
    const first = (
      await as()
        .post('/banking/statements/import', body(HDFC.join('\n')))
        .expect(201)
    ).body;
    firstImport = first.id;
    expect(first).toMatchObject({ added: 3, duplicates: 0, rejected: 0 });
    expect(
      (
        await as()
          .post('/banking/statements/import', body(HDFC.join('\n')))
          .expect(201)
      ).body,
    ).toMatchObject({ added: 0, duplicates: 3 });
    // The next statement overlaps the last two days and adds one line, with one row that can't be read
    const next = [
      ...HDFC.slice(0, 3),
      HDFC[4],
      HDFC[5],
      '09/05/26,BANK CHARGES,,09/05/26,590.00,,"4,45,510.00"',
      '31/02/26,BROKEN,,,10.00,,',
    ].join('\n');
    const p = (
      await as().post('/banking/statements/preview', body(next)).expect(200)
    ).body;
    expect(p).toMatchObject({
      total: 3,
      duplicates: 2,
      issues: [{ row: 7, problem: 'date', text: '31/02/26' }],
    });
    expect(
      (
        await as()
          .post(
            '/banking/statements/import',
            body(next, { fileName: 'hdfc-may-2.csv' }),
          )
          .expect(201)
      ).body,
    ).toMatchObject({ added: 1, duplicates: 2, rejected: 1 });
    const lines = (
      await as('auditor')
        .get(`/banking/statements/lines?bankAccountId=${acc.bank}`)
        .expect(200)
    ).body;
    expect(lines.total).toBe(4);
    expect(lines.items[0]).toMatchObject({
      date: '2026-05-09',
      description: 'BANK CHARGES',
      amount: -59_000,
      status: 'unmatched',
      balance: 44_551_000,
    });
  });

  it('remembers the layout, and takes a corrected one', async () => {
    // Headers the guesser doesn't know: refused until the columns are given, then remembered
    const odd = 'When,What,How much\n2026-05-10,Interest,12.34\n';
    expect(
      (
        await as()
          .post(
            '/banking/statements/preview',
            body(odd, { bankAccountId: acc.usd }),
          )
          .expect(400)
      ).body.details.reason,
    ).toBe('layout_unknown');
    const mapping = {
      headerRows: 1,
      delimiter: ',',
      date: 0,
      description: 1,
      reference: null,
      amount: 2,
      moneyIn: null,
      moneyOut: null,
      balance: null,
      dateFormat: 'YMD',
      decimal: '.',
    };
    expect(
      (
        await as()
          .post(
            '/banking/statements/import',
            body(odd, { bankAccountId: acc.usd, mapping }),
          )
          .expect(201)
      ).body.added,
    ).toBe(1);
    const again = 'When,What,How much\n2026-05-11,Fee,-1.00\n';
    expect(
      (
        await as()
          .post(
            '/banking/statements/preview',
            body(again, { bankAccountId: acc.usd }),
          )
          .expect(200)
      ).body.lines[0],
    ).toMatchObject({ date: '2026-05-11', amount: -100 });
  });

  it('reads OFX with the bank’s own transaction ids', async () => {
    const ofx = `OFXHEADER:100\n<OFX><STMTTRN><DTPOSTED>20260520<TRNAMT>500.00<FITID>A1<NAME>NORTHWIND INC</STMTTRN><STMTTRN><DTPOSTED>20260521<TRNAMT>-25.00<FITID>A2<NAME>WIRE FEE</STMTTRN></OFX>`;
    expect(
      (
        await as()
          .post(
            '/banking/statements/import',
            body(ofx, { bankAccountId: acc.usd, fileName: 'wise.ofx' }),
          )
          .expect(201)
      ).body,
    ).toMatchObject({ added: 2 });
    expect(
      (
        await as()
          .post(
            '/banking/statements/import',
            body(ofx, { bankAccountId: acc.usd, fileName: 'wise.ofx' }),
          )
          .expect(201)
      ).body,
    ).toMatchObject({ added: 0, duplicates: 2 });
  });

  it('refuses other accounts, empty results and Auditors; lists imports and undoes one', async () => {
    expect(
      (
        await as()
          .post(
            '/banking/statements/preview',
            body(HDFC.join('\n'), { bankAccountId: acc.sales }),
          )
          .expect(400)
      ).body.details.reason,
    ).toBe('bank_invalid');
    expect(
      (
        await as()
          .post(
            '/banking/statements/import',
            body('Date,Narration,Amount\nnot a date,x,\n'),
          )
          .expect(400)
      ).body.details.reason,
    ).toBe('nothing_to_import');
    await as('auditor')
      .post('/banking/statements/import', body(HDFC.join('\n')))
      .expect(403);
    const imports = (
      await as('auditor')
        .get(`/banking/statements/imports?bankAccountId=${acc.bank}`)
        .expect(200)
    ).body as { id: string; added: number }[];
    expect(imports.map((i) => i.added)).toEqual([1, 0, 3]);
    await as().delete(`/banking/statements/imports/${firstImport}`).expect(204);
    expect(
      (
        await as()
          .get(`/banking/statements/lines?bankAccountId=${acc.bank}`)
          .expect(200)
      ).body.total,
    ).toBe(1);
    await as().delete(`/banking/statements/imports/${firstImport}`).expect(404);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org,
          action: { in: ['org.banking.import', 'org.banking.import_undo'] },
        },
      }),
    ).toBe(7);
  });
});
