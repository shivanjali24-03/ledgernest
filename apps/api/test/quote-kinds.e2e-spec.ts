import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

describe('Proforma invoices and sales orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let sales = '';
  let customer = '';
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const contact = (body: object) =>
    post('/contacts', { isCustomer: true, isVendor: true, ...body });

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
          name: `KINDS ${run}`,
          slug: `kinds-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
          addressLine1: 'Plot 4, Chakan MIDC',
          city: 'Pune',
          postalCode: '410501',
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
    const account = async (code: string, type: string, subtype: string) =>
      (
        await post('/accounts', {
          name: `${code} ${run}`,
          code,
          type,
          subtype,
        }).expect(201)
      ).body.id as string;
    sales = await account('4100', 'income', 'operating_income');
    await account('1200', 'asset', 'accounts_receivable');
    await account('2000', 'liability', 'accounts_payable');
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await contact({ name: 'Kumar Logistics', isVendor: false }).expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  type Q = {
    id: string;
    kind: string;
    number: string;
    reference: string | null;
    status: string;
  };
  const make = (kind?: string) =>
    post('/quotes', {
      contactId: customer,
      ...(kind ? { kind } : {}),
      quoteDate: '2026-06-01',
      expiryDate: '2026-06-15',
      lines: [
        {
          description: 'Annual maintenance',
          quantity: '1',
          unitPrice: 50_000_00,
          accountId: sales,
        },
      ],
    });

  it('numbers quotations, proformas and sales orders each on their own', async () => {
    expect(((await make().expect(201)).body as Q).number).toBe('QT-0001');
    expect(((await make('proforma').expect(201)).body as Q).number).toBe(
      'PI-0001',
    );
    expect(((await make('sales_order').expect(201)).body as Q).number).toBe(
      'SO-0001',
    );
    expect(((await make('quote').expect(201)).body as Q).number).toBe(
      'QT-0002',
    );
    const list = (
      await auth(http().get('/api/v1/quotes?kind=proforma')).expect(200)
    ).body as { items: Q[] };
    expect(list.items.map((q) => q.number)).toEqual(['PI-0001']);
    const found = (
      await auth(http().get('/api/v1/quotes?search=so-1')).expect(200)
    ).body as { items: Q[] };
    expect(found.items.map((q) => q.number)).toEqual(['SO-0001']);
  });

  it('copies an accepted quote into a sales order, which becomes the invoice', async () => {
    const q = (await make().expect(201)).body as Q;
    const so = (
      await post(`/quotes/${q.id}/copy`, { kind: 'sales_order' }).expect(201)
    ).body as Q;
    expect(so).toMatchObject({
      kind: 'sales_order',
      number: 'SO-0002',
      reference: q.number,
      status: 'draft',
    });
    const done = (await post(`/quotes/${so.id}/convert`, {}).expect(200))
      .body as { quote: Q; invoiceId: string };
    expect(done.quote.status).toBe('invoiced');
    const inv = (
      await auth(http().get(`/api/v1/invoices/${done.invoiceId}`)).expect(200)
    ).body as { reference: string };
    expect(inv.reference).toBe(q.number);
  });

  it('prints a proforma as one, saying it isn’t a tax invoice', async () => {
    const pi = (await make('proforma').expect(201)).body as Q;
    const pdf = await auth(http().get(`/api/v1/quotes/${pi.id}/pdf`))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-disposition']).toContain('proforma-pi-');
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain(`Proforma invoice ${pi.number}`);
    expect(text).toContain('not a tax invoice');
  });
});
