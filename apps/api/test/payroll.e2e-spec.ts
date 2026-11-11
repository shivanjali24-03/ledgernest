import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Run = {
  id: string;
  status: string;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  dues: { pf: number; esi: number; pt: number; tds: number };
  payslips: {
    id: string;
    employee: { code: string };
    daysPaid: number;
    gross: number;
    net: number;
    deductions: { code: string; amount: number }[];
  }[];
};

/** A month's salaries: payslips with PF, ESI, professional tax and TDS, posted, then paid */
describe('Payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  let org = '';
  let bank = '';
  let asha = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };
  const balance = async (systemKey: string) => {
    const a = await prisma.account.findFirst({
      where: { organizationId: org, systemKey },
      select: { id: true },
    });
    if (!a) return 0;
    const s = await prisma.journalLine.aggregate({
      where: { accountId: a.id, entry: { status: 'posted' } },
      _sum: { debit: true, credit: true },
    });
    return Number((s._sum.debit ?? 0n) - (s._sum.credit ?? 0n));
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
          name: `Payroll ${run}`,
          slug: `payroll-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['bookkeeper', 'bookkeeper'],
      ['auditor', 'auditor'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: key,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    bank = (
      await as()
        .post('/accounts', {
          name: `bank ${run}`,
          code: '1100',
          type: 'asset',
          subtype: 'bank',
        })
        .expect(201)
    ).body.id;
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('keeps employees with their salary, private to those who run payroll', async () => {
    asha = (
      await as()
        .post('/payroll/employees', {
          code: 'E-001',
          name: 'Asha Patil',
          designation: 'Accounts assistant',
          gender: 'male',
          dateOfJoining: '2025-04-01',
          stateCode: '27',
          uan: '100200300400',
          basic: 10_000_00,
          hra: 4_000_00,
          specialAllowance: 4_000_00,
        })
        .expect(201)
    ).body.id;
    await as()
      .post('/payroll/employees', {
        code: 'E-002',
        name: 'Ravi Kulkarni',
        dateOfJoining: '2026-06-16',
        stateCode: '27',
        pan: 'ABCPK1234D',
        basic: 1_00_000_00,
        hra: 50_000_00,
        specialAllowance: 50_000_00,
      })
      .expect(201);
    expect(
      (
        await as()
          .post('/payroll/employees', {
            code: 'e-001',
            name: 'X',
            dateOfJoining: '2026-01-01',
            basic: 1,
          })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'code_taken' });
    // A bookkeeper doesn't see salaries; an auditor does, but can't run payroll
    await as('bookkeeper').get('/payroll/employees').expect(403);
    await as('auditor').get('/payroll/employees').expect(200);
    await as('auditor').post('/payroll/runs', { month: '2026-06' }).expect(403);
  });

  it('runs June: days not paid, a part month for a joiner, PF, ESI, professional tax and TDS', async () => {
    const r = (
      await as()
        .post('/payroll/runs', {
          month: '2026-06',
          lossOfPay: [{ employeeId: asha, days: 6 }],
        })
        .expect(201)
    ).body as Run;
    const [a, b] = r.payslips;
    // Asha: 24 of 30 days
    expect(a).toMatchObject({ daysPaid: 24, gross: 14_400_00 });
    expect(a!.deductions.map((d) => [d.code, d.amount])).toEqual([
      ['pf', 960_00],
      ['esi', 108_00],
      ['pt', 200_00],
    ]);
    // Ravi joined on the 16th: 15 days; TDS a twelfth of the year's on his full salary
    expect(b).toMatchObject({ daysPaid: 15, gross: 1_00_000_00 });
    expect(b!.deductions.map((d) => [d.code, d.amount])).toEqual([
      ['pf', 1_800_00],
      ['pt', 200_00],
      ['tds', 24_375_00],
    ]);
    expect(r).toMatchObject({
      status: 'draft',
      gross: 1_14_400_00,
      deductions: 27_643_00,
      net: 86_757_00,
      employerCost: 3_458_00,
      dues: {
        pf:
          960_00 + 960_00 + 40_00 + 40_00 + 1_800_00 + 1_800_00 + 75_00 + 75_00,
        esi: 108_00 + 468_00,
        pt: 400_00,
        tds: 24_375_00,
      },
    });
    expect(
      (await as().post('/payroll/runs', { month: '2026-06' }).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'run_exists' });
  });

  it('posts the month at its end and pays it from the bank', async () => {
    const r = (
      (await as().get('/payroll/runs').expect(200)).body as { runs: Run[] }
    ).runs[0]!;
    await as()
      .post(`/payroll/runs/${r.id}/pay`, {
        date: '2026-07-01',
        bankAccountId: bank,
      })
      .expect(409);
    await as().post(`/payroll/runs/${r.id}/post`).expect(200);
    expect(await balance('salaries')).toBe(1_14_400_00);
    expect(await balance('employer_contributions')).toBe(3_458_00);
    expect(await balance('salaries_payable')).toBe(-86_757_00);
    expect(await balance('tds_salary_payable')).toBe(-24_375_00);
    expect(await balance('esi_payable')).toBe(-576_00);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: org, reference: 'PAYROLL 2026-06' },
      select: { date: true },
    });
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-06-30');
    const paid = (
      await as()
        .post(`/payroll/runs/${r.id}/pay`, {
          date: '2026-07-01',
          bankAccountId: bank,
        })
        .expect(200)
    ).body as Run & { paidOn: string };
    expect(paid).toMatchObject({ status: 'paid', paidOn: '2026-07-01' });
    expect(await balance('salaries_payable')).toBe(0);
    const bankSum = await prisma.journalLine.aggregate({
      where: { accountId: bank },
      _sum: { credit: true },
    });
    expect(Number(bankSum._sum.credit)).toBe(86_757_00);
    // Paid: it can't go back to a draft
    expect(
      (await as().post(`/payroll/runs/${r.id}/unpost`).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'already_paid' });
  });

  it('gives each employee a payslip PDF', async () => {
    const r = (
      (await as().get('/payroll/runs').expect(200)).body as { runs: Run[] }
    ).runs[0]!;
    const res = await as()
      .get(`/payroll/payslips/${r.payslips[0]!.id}/pdf`)
      .buffer(true)
      .parse((x, cb) => {
        const c: Buffer[] = [];
        x.on('data', (d: Buffer) => c.push(d));
        x.on('end', () => cb(null, Buffer.concat(c)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      'payslip-2026-06-e-001.pdf',
    );
    const text = (res.body as Buffer).toString('latin1');
    expect(text).toContain('Payslip for June 2026');
    expect(text).toContain('Asha Patil \\(E-001\\)');
    expect(text).toContain('Net pay: Rs 13132.00');
    await as('bookkeeper')
      .get(`/payroll/payslips/${r.payslips[0]!.id}/pdf`)
      .expect(403);
  });
});
