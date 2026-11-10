import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Cheques for vendor payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const vendor: Record<string, string> = {};
  let org = '';
  let token = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const record = async (
    contactId: string,
    vendorReference: string,
    billDate: string,
    unitPrice: number,
    dueDate?: string,
  ) => {
    const b = (
      await post('/bills', {
        contactId,
        vendorReference,
        billDate,
        ...(dueDate ? { dueDate } : {}),
        lines: [
          {
            description: 'Fabrication',
            quantity: 1,
            unitPrice,
            accountId: acc.jobwork,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/bills/${b.id}/record`).expect(200);
    return b.id;
  };
  const pay = (
    contactId: string,
    billId: string,
    date: string,
    amount: number,
  ) =>
    post('/payments/payments', {
      contactId,
      date,
      bankAccountId: acc.bank,
      amount,
      allocations: [{ billId, amount }],
    }).expect(201);

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
          name: `Cheques ${run}`,
          slug: `cheque-${run}`,
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
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['jobwork', { code: '5100', type: 'expense', subtype: 'cost_of_sales' }],
    ] as const) {
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    }
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const pdf = (p: string) =>
    get(p)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  it('prints a vendor payment onto a cheque leaf: payee, date boxes, words and figures after TDS', async () => {
    vendor.sharma = (
      await post('/contacts', {
        name: 'Sharma',
        legalName: 'Sharma Fabricators Private Limited',
        isVendor: true,
        isCustomer: false,
      }).expect(201)
    ).body.id;
    const bill = await record(vendor.sharma, 'SF-1', '2026-10-01', 1_18_000_00);
    const p = (await pay(vendor.sharma, bill, '2026-10-05', 1_18_000_00))
      .body as { id: string };
    const r = await pdf(`/payments/${p.id}/cheque?offsetX=1.5`).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toContain(
      'cheque-pay-2026-27-0001.pdf',
    );
    const text = (r.body as Buffer).toString('latin1');
    expect(text).toContain('/MediaBox [0 0 576 261]');
    expect(text).toContain('(05102026) Tj');
    expect(text).toContain('(SHARMA FABRICATORS PRIVATE LIMITED) Tj');
    expect(text).toContain('(One Lakh Eighteen Thousand Only) Tj');
    expect(text).toContain('(**1,18,000/-) Tj');
    expect(text).toContain('(A/c Payee) Tj');
    await get(`/payments/${p.id}/cheque?offsetX=99`).expect(400);
    const uncrossed = await pdf(
      `/payments/${p.id}/cheque?crossed=false`,
    ).expect(200);
    expect((uncrossed.body as Buffer).toString('latin1')).not.toContain(
      'A/c Payee',
    );
  });

  it('won’t print a receipt from a customer', async () => {
    const kumar = (
      await post('/contacts', {
        name: 'Kumar',
        isVendor: false,
        isCustomer: true,
      }).expect(201)
    ).body.id;
    acc.sales = (
      await post('/accounts', {
        name: `sales ${run}`,
        code: '4100',
        type: 'income',
        subtype: 'operating_income',
      }).expect(201)
    ).body.id;
    await post('/accounts', {
      name: `debtors ${run}`,
      code: '1300',
      type: 'asset',
      subtype: 'accounts_receivable',
    }).expect(201);
    const r = (
      await post('/payments/receipts', {
        contactId: kumar,
        date: '2026-10-06',
        bankAccountId: acc.bank,
        amount: 5_000_00,
      }).expect(201)
    ).body as { id: string };
    expect(
      (await get(`/payments/${r.id}/cheque`).expect(409)).body.details,
    ).toMatchObject({ reason: 'not_payment' });
  });
});
