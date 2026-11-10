import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Quote = {
  id: string;
  number: string;
  status: string;
  state: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  reference: string | null;
  invoice: { id: string; number: string | null; status: string } | null;
  lines: {
    description: string;
    quantity: string;
    discount: number;
    amount: number;
  }[];
};

describe('Quotes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let customer = '';
  let vendor = '';

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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const draft = (over: object = {}) => ({
    contactId: customer,
    quoteDate: '2026-06-01',
    expiryDate: '2026-06-30',
    reference: 'RFQ-17',
    lines: [
      {
        description: 'Warehouse racking',
        quantity: '4',
        unitPrice: 250_000,
        discount: 10,
        accountId: acc.sales,
      },
      {
        description: 'Installation',
        quantity: 1,
        unitPrice: 100_000,
        accountId: acc.sales,
      },
    ],
    ...over,
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
          name: `Quotes ${run}`,
          slug: `quotes-${run}`,
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
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await as()
        .post('/contacts', {
          name: 'Patil Cold Storage',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    vendor = (
      await as()
        .post('/contacts', {
          name: 'Only A Vendor',
          isCustomer: false,
          isVendor: true,
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

  let first = '';
  let second = '';

  it('prices a quote with the invoice rules, numbered in turn, and posts nothing', async () => {
    const q = (await as().post('/quotes', draft()).expect(201)).body as Quote;
    first = q.id;
    // 4 × 2,500 less 10% = 9,000, plus 1,000
    expect(q).toMatchObject({
      number: 'QT-0001',
      status: 'draft',
      subtotal: 1_000_000,
      taxTotal: 0,
      total: 1_000_000,
      invoice: null,
    });
    expect(q.lines.map((l) => [l.quantity, l.discount, l.amount])).toEqual([
      ['4', 10, 900_000],
      ['1', 0, 100_000],
    ]);
    second = (
      (
        await as()
          .post(
            '/quotes',
            draft({ quoteDate: '2026-05-01', expiryDate: '2026-05-15' }),
          )
          .expect(201)
      ).body as Quote
    ).id;
    expect((await as().get(`/quotes/${second}`).expect(200)).body.number).toBe(
      'QT-0002',
    );
    expect(
      await prisma.journalEntry.count({ where: { organizationId: org } }),
    ).toBe(0);
    // Only customers, and the same line rules as invoices
    expect(
      (
        await as()
          .post('/quotes', draft({ contactId: vendor }))
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'not_customer' });
    await as()
      .post('/quotes', draft({ expiryDate: '2026-05-01' }))
      .expect(400);
  });

  it('moves through sent and accepted, changing only while open', async () => {
    await as()
      .patch(`/quotes/${first}`, draft({ notes: 'Price includes delivery.' }))
      .expect(200);
    expect(
      (
        await as()
          .post(`/quotes/${first}/status`, { status: 'sent' })
          .expect(200)
      ).body.status,
    ).toBe('sent');
    await as().patch(`/quotes/${first}`, draft()).expect(200);
    await as().delete(`/quotes/${first}`).expect(409);
    await as()
      .post(`/quotes/${first}/status`, { status: 'accepted' })
      .expect(200);
    expect(
      (await as().patch(`/quotes/${first}`, draft()).expect(409)).body.details,
    ).toMatchObject({ reason: 'not_editable' });
    // Declined can come back as accepted or sent, but not draft
    await as()
      .post(`/quotes/${second}/status`, { status: 'declined' })
      .expect(200);
    expect(
      (
        await as()
          .post(`/quotes/${second}/status`, { status: 'draft' })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'bad_move', from: 'declined' });
    expect(
      (await as().post(`/quotes/${second}/convert`, {}).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'declined' });
  });

  it('turns an accepted quote into a draft invoice with the same lines, once', async () => {
    const r = (
      await as()
        .post(`/quotes/${first}/convert`, { issueDate: '2026-06-10' })
        .expect(200)
    ).body as { quote: Quote; invoiceId: string };
    expect(r.quote).toMatchObject({
      status: 'invoiced',
      invoice: { id: r.invoiceId, number: null, status: 'draft' },
    });
    const inv = (await as().get(`/invoices/${r.invoiceId}`).expect(200)).body;
    expect(inv).toMatchObject({
      status: 'draft',
      issueDate: '2026-06-10',
      reference: 'RFQ-17',
      total: 1_000_000,
    });
    expect(
      inv.lines.map((l: { description: string; amount: number }) => [
        l.description,
        l.amount,
      ]),
    ).toEqual([
      ['Warehouse racking', 900_000],
      ['Installation', 100_000],
    ]);
    expect(
      (await as().post(`/quotes/${first}/convert`, {}).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'already_invoiced' });
    await as().post(`/quotes/${first}/status`, { status: 'sent' }).expect(409);
    // Deleting the draft invoice puts the quote back to accepted
    await as().delete(`/invoices/${r.invoiceId}`).expect(204);
    expect((await as().get(`/quotes/${first}`).expect(200)).body).toMatchObject(
      {
        status: 'accepted',
        invoice: null,
      },
    );
  });

  it('lists by state, customer and number, and needs invoice permissions', async () => {
    const third = (
      await as()
        .post(
          '/quotes',
          draft({ quoteDate: '2099-01-01', expiryDate: '2099-01-31' }),
        )
        .expect(201)
    ).body as Quote;
    const list = async (q: string) =>
      (
        (await as('auditor').get(`/quotes?${q}`).expect(200)).body
          .items as Quote[]
      ).map((x) => x.number);
    expect(await list('')).toEqual(['QT-0003', 'QT-0001', 'QT-0002']);
    expect(await list('state=open')).toEqual(['QT-0003']);
    expect(await list('state=accepted')).toEqual(['QT-0001']);
    expect(await list('search=QT-0002')).toEqual(['QT-0002']);
    expect(await list(`contactId=${vendor}`)).toEqual([]);
    expect(third.state).toBe('draft');
    // A past-dated open quote shows as expired
    const old = (
      await as()
        .post(
          '/quotes',
          draft({ quoteDate: '2026-01-01', expiryDate: '2026-01-31' }),
        )
        .expect(201)
    ).body as Quote;
    expect(old.state).toBe('expired');
    expect(await list('state=expired')).toEqual(['QT-0004']);
    await as().delete(`/quotes/${old.id}`).expect(204);
    await as('auditor').post('/quotes', draft()).expect(403);
    await as('viewer').get('/quotes').expect(403);
    const actions = await prisma.auditLog.findMany({
      where: { organizationId: org, entityType: 'quote' },
      select: { action: true },
    });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set([
        'org.quote.create',
        'org.quote.update',
        'org.quote.send',
        'org.quote.accept',
        'org.quote.decline',
        'org.quote.invoice',
        'org.quote.delete',
      ]),
    );
  });
});
