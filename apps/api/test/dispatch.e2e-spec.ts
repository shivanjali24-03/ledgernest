import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Order and dispatch details on invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let sales = '';
  let customer = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));

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
          name: `Dispatch ${run}`,
          slug: `dispatch-${run}`,
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
    await post('/accounts', {
      name: `debtors ${run}`,
      code: '1300',
      type: 'asset',
      subtype: 'accounts_receivable',
    }).expect(201);
    sales = (
      await post('/accounts', {
        name: `sales ${run}`,
        code: '4100',
        type: 'income',
        subtype: 'operating_income',
      }).expect(201)
    ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await post('/contacts', {
        name: 'Gupta Traders',
        isCustomer: true,
        isVendor: false,
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

  it('keeps the buyer’s order, transporter, LR and vehicle with the invoice, and prints them', async () => {
    const d = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-05-10',
        dispatch: {
          buyerOrderNo: 'PO-7781',
          buyerOrderDate: '2026-05-02',
          dispatchDocNo: 'LR 55120',
          dispatchedThrough: 'VRL Logistics',
          destination: 'Nagpur',
          vehicleNo: 'mh 12 ab 1234',
          termsOfDelivery: 'Door delivery',
        },
        lines: [
          {
            description: 'Cement bags',
            quantity: 100,
            unitPrice: 400_00,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as { id: string; dispatch: Record<string, string | null> };
    expect(d.dispatch).toMatchObject({
      buyerOrderNo: 'PO-7781',
      vehicleNo: 'MH12AB1234',
      deliveryNote: null,
    });
    await post('/invoices', {
      contactId: customer,
      issueDate: '2026-05-10',
      dispatch: { vehicleNo: 'X1' },
      lines: [
        { description: 'x', quantity: 1, unitPrice: 100, accountId: sales },
      ],
    }).expect(400);
    await post(`/invoices/${d.id}/issue`).expect(200);
    const pdf = await get(`/invoices/${d.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('Dispatched through: VRL Logistics');
    expect(text).toContain('Vehicle: MH12AB1234');
  });
});
