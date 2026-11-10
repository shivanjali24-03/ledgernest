import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Share = { token: string; views: number; lastViewedAt: string | null };

describe('Invoice links for customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let customer = '';
  let invoice = '';
  let draft = '';

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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  // Nobody signed in, no organisation header: only the link
  const visitor = (p: string) => http().get(`/api/v1/public/invoices/${p}`);
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
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
          name: `Share ${run}`,
          legalName: `Share Traders ${run}`,
          slug: `share-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: '27AAPFN1234C1Z5',
          upiId: 'sharetraders@okhdfcbank',
          invoiceTerms: 'Pay within 15 days.',
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['viewer', 'viewer'],
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
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    const make = async () =>
      (
        await as()
          .post('/invoices', {
            contactId: customer,
            issueDate: '2026-06-20',
            dueDate: '2026-07-20',
            notes: 'Internal: chase Ravi',
            lines: [
              {
                description: 'Freight, Pune to Nashik',
                quantity: 2,
                unitPrice: 12_500_00,
                accountId: acc.sales,
              },
            ],
          })
          .expect(201)
      ).body.id as string;
    invoice = await make();
    await as().post(`/invoices/${invoice}/issue`).expect(200);
    draft = await make();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let token = '';

  it('makes one link per issued invoice, and only for people who manage invoices', async () => {
    expect(
      (await as().post(`/invoices/${draft}/share`).expect(409)).body.details,
    ).toMatchObject({ reason: 'not_issued' });
    await as('viewer').post(`/invoices/${invoice}/share`).expect(403);
    const s = (await as().post(`/invoices/${invoice}/share`).expect(200))
      .body as Share;
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(s).toMatchObject({ views: 0, lastViewedAt: null });
    token = s.token;
    // Sharing again gives the same link
    expect(
      (
        (await as().post(`/invoices/${invoice}/share`).expect(200))
          .body as Share
      ).token,
    ).toBe(token);
    expect(
      (await as().get(`/invoices/${invoice}`).expect(200)).body.share,
    ).toMatchObject({ token, views: 0 });
  });

  it('opens for anyone with the link, showing what the customer needs and nothing internal', async () => {
    const r = await visitor(token).expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.body).toMatchObject({
      organization: {
        name: `Share Traders ${run}`,
        taxId: '27AAPFN1234C1Z5',
        terms: 'Pay within 15 days.',
      },
      invoice: {
        number: 'INV/2026-27/0001',
        currency: 'INR',
        customer: { name: 'Kumar Logistics' },
        total: 25_000_00,
        balance: 25_000_00,
        lines: [
          {
            description: 'Freight, Pune to Nashik',
            quantity: '2',
            unitPrice: 12_500_00,
            amount: 25_000_00,
          },
        ],
      },
      upi: {
        upiId: 'sharetraders@okhdfcbank',
        link: expect.stringContaining('am=25000.00'),
      },
    });
    const json = JSON.stringify(r.body);
    for (const secret of [
      org,
      invoice,
      customer,
      acc.sales,
      acc.debtors,
      'Internal: chase Ravi',
      'journal',
    ])
      expect(json).not.toContain(secret);
    // The PDF too, with its UPI code
    const pdf = await binary(visitor(`${token}/pdf`)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).toString('latin1')).toContain(
      '(Scan to pay with any UPI app) Tj',
    );
    // Counted for the business to see
    const seen = (await as().get(`/invoices/${invoice}`).expect(200)).body
      .share as Share;
    expect(seen.views).toBe(1);
    expect(seen.lastViewedAt).toBeTruthy();
  });

  it('turns away made-up links', async () => {
    for (const bad of [
      'x'.repeat(32),
      'short',
      `${token.slice(0, 31)}!`,
      '../../invoices',
    ])
      await visitor(encodeURIComponent(bad)).expect(404);
    await visitor('x'.repeat(32) + '/pdf').expect(404);
  });

  it('shows paid once paid, and stops when the link is turned off or the invoice voided', async () => {
    await prisma.invoice.update({
      where: { id: invoice },
      data: { amountPaid: 25_000_00 },
    });
    const paid = (await visitor(token).expect(200)).body;
    expect(paid.invoice).toMatchObject({ state: 'paid', balance: 0 });
    expect(paid.upi).toBeNull();
    await prisma.invoice.update({
      where: { id: invoice },
      data: { amountPaid: 0 },
    });

    await as('viewer').delete(`/invoices/${invoice}/share`).expect(403);
    await as().delete(`/invoices/${invoice}/share`).expect(200);
    await visitor(token).expect(404);
    expect(
      (await as().get(`/invoices/${invoice}`).expect(200)).body.share,
    ).toBeNull();
    // A new link is a new token; voiding makes it gone
    const again = (await as().post(`/invoices/${invoice}/share`).expect(200))
      .body as Share;
    expect(again.token).not.toBe(token);
    await as()
      .post(`/invoices/${invoice}/void`, {
        date: '2026-07-01',
        reason: 'Wrong rate',
      })
      .expect(200);
    expect((await visitor(again.token).expect(410)).body.details).toMatchObject(
      { reason: 'void' },
    );
    const actions = await prisma.auditLog.findMany({
      where: { organizationId: org, entityId: invoice },
      select: { action: true },
    });
    expect(
      actions.map((a) => a.action).filter((a) => a.includes('share')),
    ).toEqual(
      expect.arrayContaining(['org.invoice.share', 'org.invoice.unshare']),
    );
  });
});
