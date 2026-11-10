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

  it('ships to another address: its state becomes the place of supply unless chosen, and it prints', async () => {
    const shipTo = {
      name: 'Gupta Warehouse',
      line1: 'Plot 4, Peenya',
      city: 'Bengaluru',
      region: 'Karnataka',
      postalCode: '560058',
      country: 'IN',
    };
    const d = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-05-10',
        shipTo,
        lines: [
          {
            description: 'Cement bags',
            quantity: 10,
            unitPrice: 400_00,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as { id: string; placeOfSupply: string; shipTo: typeof shipTo };
    expect(d).toMatchObject({
      placeOfSupply: '29',
      shipTo: { name: 'Gupta Warehouse', region: 'Karnataka' },
    });
    // Bill to one, ship to a third party: the place of supply can still be chosen
    const own = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-05-10',
        shipTo,
        placeOfSupply: '27',
        lines: [
          {
            description: 'Cement bags',
            quantity: 10,
            unitPrice: 400_00,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as { placeOfSupply: string };
    expect(own.placeOfSupply).toBe('27');
    await post(`/invoices/${d.id}/issue`).expect(200);
    const pdf = await get(`/invoices/${d.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((pdf.body as Buffer).toString('latin1')).toContain(
      'Ship to: Gupta Warehouse, Plot 4, Peenya',
    );
  });

  it('rounds rupee totals to the rupee when asked, booking the difference to Round off, and marks the copies', async () => {
    const patch = (p: string, body: object) =>
      auth(http().patch(`/api/v1${p}`)).send(body);
    const gst18 = (
      (await post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    await patch('/organization', { roundInvoiceTotals: true }).expect(200);
    const d = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-05-10',
        lines: [
          {
            description: 'Cement bag',
            quantity: 1,
            unitPrice: 1_000_30,
            taxGroupId: gst18,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as {
      id: string;
      subtotal: number;
      taxTotal: number;
      roundOff: number;
      total: number;
    };
    expect(d).toMatchObject({
      subtotal: 1_000_30,
      roundOff: -36, // CGST 9% + SGST 9%, each ₹90.03
      total: 1_180_00,
    });
    const inv = (await post(`/invoices/${d.id}/issue`).expect(200)).body as {
      journalEntry: { id: string };
    };
    const entry = (await get(`/journals/${inv.journalEntry.id}`).expect(200))
      .body as {
      lines: { account: { code: string }; debit: number; credit: number }[];
    };
    expect(entry.lines.find((l) => l.account.code === '4980')).toMatchObject({
      debit: 36,
      credit: 0,
    });
    expect(entry.lines.reduce((s, l) => s + l.debit, 0)).toBe(
      entry.lines.reduce((s, l) => s + l.credit, 0),
    );
    const pdf = await get(`/invoices/${d.id}/pdf?copy=duplicate`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('DUPLICATE FOR TRANSPORTER');
    expect(text).toContain('Round off');
    await get(`/invoices/${d.id}/pdf?copy=fifth`).expect(400);
    await patch('/organization', { roundInvoiceTotals: false }).expect(200);
  });
});
