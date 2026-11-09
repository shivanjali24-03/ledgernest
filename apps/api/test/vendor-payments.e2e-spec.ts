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
  }[];
};
type BillView = {
  balance: number;
  amountPaid: number;
  state: string;
  payments: { number: string }[];
};

describe('Payments to vendors against bills (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const bill: Record<string, string> = {};
  let org = '';

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
  const record = async (
    contactId: string,
    billDate: string,
    lines: object[],
  ) => {
    const d = (
      await as().post('/bills', { contactId, billDate, lines }).expect(201)
    ).body;
    return (await as().post(`/bills/${d.id}/record`).expect(200)).body as {
      id: string;
      total: number;
    };
  };
  const billOf = async (id: string) =>
    (await as().get(`/bills/${id}`).expect(200)).body as BillView;

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
          name: `Vendor payments ${run}`,
          slug: `vpay-${run}`,
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
    await as()
      .put('/currencies/USD/rates/2026-05-01', { rate: '90' })
      .expect(200);
    await as()
      .put('/currencies/USD/rates/2026-05-20', { rate: '93' })
      .expect(200);
    for (const [key, body] of [
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'usdCreditors',
        {
          code: '2050',
          type: 'liability',
          subtype: 'accounts_payable',
          currency: 'USD',
        },
      ],
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'usdBank',
        { code: '1150', type: 'asset', subtype: 'bank', currency: 'USD' },
      ],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    contact.sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Supplies',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
    contact.aws = (
      await as()
        .post('/contacts', {
          name: 'Amazon Web Services',
          isCustomer: false,
          isVendor: true,
          currency: 'USD',
        })
        .expect(201)
    ).body.id;
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    bill.a = (
      await record(contact.sharma, '2026-05-02', [
        {
          description: 'Rent, May',
          quantity: 1,
          unitPrice: 500_000,
          accountId: acc.rent,
        },
      ])
    ).id;
    bill.b = (
      await record(contact.sharma, '2026-05-06', [
        {
          description: 'Stationery',
          quantity: 1,
          unitPrice: 200_000,
          accountId: acc.rent,
        },
      ])
    ).id;
    bill.u = (
      await record(contact.aws, '2026-05-08', [
        {
          description: 'AWS, April',
          quantity: 1,
          unitPrice: 40_000,
          accountId: acc.rent,
        },
      ])
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let payment = '';

  it('lists what is owed to the vendor, oldest due first', async () => {
    const open = (
      await as('auditor')
        .get(`/payments/open-bills/${contact.sharma}`)
        .expect(200)
    ).body as { id: string; number: string; balance: number }[];
    expect(open.map((b) => [b.id, b.balance])).toEqual([
      [bill.a, 500_000],
      [bill.b, 200_000],
    ]);
    expect(open[0]!.number).toBe('BILL/2026-27/0001');
  });

  it('refuses customers, over-allocation and invoices of another kind', async () => {
    const base = { date: '2026-05-15', bankAccountId: acc.bank, amount: 1_000 };
    expect(
      (
        await as()
          .post('/payments/payments', { ...base, contactId: contact.kumar })
          .expect(400)
      ).body.details.reason,
    ).toBe('not_vendor');
    expect(
      (
        await as()
          .post('/payments/payments', {
            ...base,
            contactId: contact.sharma,
            amount: 600_000,
            allocations: [{ billId: bill.a, amount: 500_001 }],
          })
          .expect(409)
      ).body.details.reason,
    ).toBe('over_allocated');
    expect(
      (
        await as()
          .post('/payments/payments', {
            ...base,
            contactId: contact.sharma,
            allocations: [{ billId: bill.u, amount: 100 }],
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('bill_not_found');
    expect(
      (
        await as()
          .post('/payments/payments', {
            ...base,
            contactId: contact.sharma,
            bankAccountId: acc.usdBank,
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('bank_currency');
    await as('auditor')
      .post('/payments/payments', { ...base, contactId: contact.sharma })
      .expect(403);
  });

  it('pays two bills, with the rest an advance to the vendor', async () => {
    const p = (
      await as()
        .post('/payments/payments', {
          contactId: contact.sharma,
          date: '2026-05-15',
          bankAccountId: acc.bank,
          amount: 650_000,
          reference: 'NEFT 88123',
          allocations: [
            { billId: bill.a, amount: 500_000 },
            { billId: bill.b, amount: 100_000 },
          ],
        })
        .expect(201)
    ).body;
    payment = p.id;
    expect(p).toMatchObject({
      kind: 'payment',
      number: 'PAY/2026-27/0001',
      allocated: 600_000,
      unallocated: 50_000,
    });
    expect(
      p.allocations.map((a: { kind: string; documentNumber: string }) => [
        a.kind,
        a.documentNumber,
      ]),
    ).toEqual([
      ['bill', 'BILL/2026-27/0001'],
      ['bill', 'BILL/2026-27/0002'],
    ]);
    const e = (await as().get(`/journals/${p.journalEntry.id}`).expect(200))
      .body as Entry;
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['2000', 650_000, 0],
      ['1100', 0, 650_000],
    ]);
    expect(await billOf(bill.a)).toMatchObject({
      balance: 0,
      state: 'paid',
      payments: [{ number: 'PAY/2026-27/0001' }],
    });
    expect(await billOf(bill.b)).toMatchObject({
      balance: 100_000,
      amountPaid: 100_000,
    });
    // ₹1,000 still owed, less ₹500 paid in advance
    expect(
      (await as().get(`/contacts/${contact.sharma}`).expect(200)).body,
    ).toMatchObject({ payable: 50_000, receivable: 0 });
    // Receipts and payments number apart
    expect(
      (await as().get('/payments?kind=payment').expect(200)).body.total,
    ).toBe(1);
    expect(
      (await as().get('/payments?kind=receipt').expect(200)).body.total,
    ).toBe(0);
  });

  it('pays a USD bill from a rupee account, realising the exchange loss', async () => {
    // Billed at 90, paid on 20 May at 93: USD 400 costs ₹37,200 for a payable carried at ₹36,000
    const p = (
      await as()
        .post('/payments/payments', {
          contactId: contact.aws,
          date: '2026-05-20',
          bankAccountId: acc.bank,
          amount: 40_000,
          allocations: [{ billId: bill.u, amount: 40_000 }],
        })
        .expect(201)
    ).body;
    expect(p).toMatchObject({ currency: 'USD', rate: '93' });
    const e = (await as().get(`/journals/${p.journalEntry.id}`).expect(200))
      .body as Entry;
    expect(
      e.lines.map((l) => [l.account.code, l.debit, l.credit, l.foreignDebit]),
    ).toEqual([
      ['2050', 3_720_000, 0, 40_000],
      ['1100', 0, 3_720_000, 0],
      ['2050', 0, 120_000, 0],
      ['4950', 120_000, 0, 0],
    ]);
    expect((await billOf(bill.u)).state).toBe('paid');
  });

  it("a paid bill can't be voided; voiding the payment opens it again", async () => {
    expect(
      (await as().post(`/bills/${bill.a}/void`, {}).expect(409)).body.details
        .reason,
    ).toBe('has_payments');
    const v = (
      await as()
        .post(`/payments/${payment}/void`, { reason: 'Wrong vendor' })
        .expect(200)
    ).body;
    expect(v.status).toBe('void');
    expect(await billOf(bill.a)).toMatchObject({
      balance: 500_000,
      payments: [],
    });
    expect((await billOf(bill.b)).balance).toBe(200_000);
    expect(
      (await as().get(`/contacts/${contact.sharma}`).expect(200)).body.payable,
    ).toBe(700_000);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.payment.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.payment.pay', 'org.payment.void']),
    );
  });
});
