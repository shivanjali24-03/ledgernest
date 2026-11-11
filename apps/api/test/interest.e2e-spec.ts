import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Interest = {
  rateBp: number;
  method: string;
  graceDays: number;
  text: string;
  accrued: number;
  perDay: number;
  daysLate: number;
} | null;

describe('Interest on late payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const who: Record<string, string> = {};
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const issue = async (contactId: string, extra: object = {}) => {
    const d = (
      await post('/invoices', {
        contactId,
        issueDate: '2026-05-01',
        dueDate: '2026-06-01',
        lines: [
          {
            description: 'Steel coils',
            quantity: 1,
            unitPrice: 1_00_000_00,
            accountId: acc.sales,
          },
        ],
        ...extra,
      }).expect(201)
    ).body as { id: string };
    return (await post(`/invoices/${d.id}/issue`).expect(200)).body as {
      id: string;
      interest: Interest;
    };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Interest ${run}`,
          slug: `interest-${run}`,
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
    token = await app
      .get(JwtService)
      .signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    for (const [key, interestRateBp] of [
      ['usual', null],
      ['dear', 2400],
      ['none', 0],
    ] as const)
      who[key] = (
        await post('/contacts', {
          name: `Buyer ${key}`,
          isCustomer: true,
          isVendor: false,
          interestRateBp,
        }).expect(201)
      ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('charges nothing until the organisation sets a rate', async () => {
    expect((await issue(who.usual!)).interest).toBeNull();
  });

  it('works interest out day by day: ₹1,00,000 due 1 June at 18%, ₹40,000 on 1 July and the rest on 11 July', async () => {
    await patch('/organization', {
      interestRateBp: 1800,
      interestMethod: 'simple',
      interestGraceDays: 0,
    }).expect(200);
    expect(
      (await get('/organization').expect(200)).body.organization,
    ).toMatchObject({
      interestRateBp: 1800,
      interestMethod: 'simple',
      interestGraceDays: 0,
    });
    const inv = await issue(who.usual!);
    expect(inv.interest).toMatchObject({
      rateBp: 1800,
      method: 'simple',
      graceDays: 0,
      text: expect.stringContaining('Interest at 18% a year'),
    });
    for (const [date, amount] of [
      ['2026-07-01', 40_000_00],
      ['2026-07-11', 60_000_00],
    ] as const)
      await post('/payments/receipts', {
        contactId: who.usual,
        date,
        bankAccountId: acc.bank,
        amount,
        allocations: [{ invoiceId: inv.id, amount }],
      }).expect(201);
    const after = (await get(`/invoices/${inv.id}`).expect(200)).body as {
      interest: Interest;
    };
    expect(after.interest).toMatchObject({
      accrued: 1_479_45 + 295_89,
      perDay: 0,
      daysLate: 40,
    });
  });

  it('takes the invoice’s own rate, else the customer’s, and keeps the terms it was issued with', async () => {
    expect((await issue(who.dear!)).interest?.rateBp).toBe(2400);
    expect((await issue(who.none!)).interest).toBeNull();
    const own = await issue(who.usual!, { interestRateBp: 1200 });
    expect(own.interest?.rateBp).toBe(1200);
    // Changing the organisation's rate later leaves issued invoices as they were
    await patch('/organization', {
      interestRateBp: 2000,
      interestGraceDays: 15,
    }).expect(200);
    expect(
      (
        (await get(`/invoices/${own.id}`).expect(200)).body as {
          interest: Interest;
        }
      )?.interest,
    ).toMatchObject({ rateBp: 1200, graceDays: 0 });
    expect((await issue(who.usual!)).interest).toMatchObject({
      rateBp: 2000,
      graceDays: 15,
    });
  });

  it('prints the terms on the invoice PDF', async () => {
    const inv = await issue(who.dear!);
    const pdf = await get(`/invoices/${inv.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).toString('latin1')).toContain(
      'Interest at 24% a year',
    );
  });
});
