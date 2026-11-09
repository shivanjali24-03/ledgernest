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
type Heads = { igst: number; cgst: number; sgst: number; cess: number };
type Item = { rate: number; taxable: number } & Heads;

describe('GST returns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const c: Record<string, string> = {};
  let org = '';
  let other = '';
  let gst18 = '';
  let kumarInvoice: { id: string; lines: { id: string }[] };

  const http = () => request(app.getHttpServer());
  const as = (o = () => org) => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users.owner!.token}`)
        .set('X-Organization-Id', o());
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
    };
  };
  const invoice = async (contactId: string, lines: object[]) => {
    const d = (
      await as()
        .post('/invoices', { contactId, issueDate: '2026-05-10', lines })
        .expect(201)
    ).body;
    return (await as().post(`/invoices/${d.id}/issue`).expect(200)).body as {
      id: string;
      lines: { id: string }[];
    };
  };
  const bill = async (contactId: string, unitPrice: number) => {
    const d = (
      await as()
        .post('/bills', {
          contactId,
          billDate: '2026-05-12',
          lines: [
            {
              description: 'Supplies',
              quantity: 1,
              unitPrice,
              taxGroupId: gst18,
              accountId: acc.supplies,
            },
          ],
        })
        .expect(201)
    ).body;
    await as().post(`/bills/${d.id}/record`).expect(200);
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
          name: `GST ${run}`,
          slug: `gst-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAACN1234F1Z'),
        },
      })
    ).id;
    other = (
      await prisma.organization.create({
        data: {
          name: `UK ${run}`,
          slug: `uk-${run}`,
          country: 'GB',
          region: 'England',
          fiscalYearStartMonth: 4,
          baseCurrency: 'GBP',
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
    for (const o of [org, other])
      await prisma.membership.create({
        data: { userId: u.id, organizationId: o, builtInRole: 'owner' },
      });
    users.owner = {
      id: u.id,
      token: await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      ),
    };
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await as()
      .put('/currencies/USD/rates/2026-05-01', { rate: '90' })
      .expect(200);
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'usdDebtors',
        {
          code: '1250',
          type: 'asset',
          subtype: 'accounts_receivable',
          currency: 'USD',
        },
      ],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      [
        'supplies',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: key, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    for (const [key, body] of [
      [
        'kumar',
        {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
          taxId: gstin('27AAKCK4821R1Z'),
        },
      ],
      [
        'bluewave',
        {
          name: 'Bluewave Clinics',
          isCustomer: true,
          isVendor: false,
          taxId: gstin('29AAACB5678D1Z'),
        },
      ],
      [
        'walkin',
        {
          name: 'Walk-in customer',
          isCustomer: true,
          isVendor: false,
          billingAddress: { region: 'Maharashtra', country: 'IN' },
        },
      ],
      [
        'big',
        {
          name: 'Big unregistered buyer',
          isCustomer: true,
          isVendor: false,
          billingAddress: { region: 'Karnataka', country: 'IN' },
        },
      ],
      [
        'northwind',
        {
          name: 'Northwind Inc.',
          isCustomer: true,
          isVendor: false,
          currency: 'USD',
          billingAddress: { country: 'US' },
        },
      ],
      [
        'sharma',
        {
          name: 'Sharma Supplies',
          isCustomer: false,
          isVendor: true,
          taxId: gstin('27ABZPS6519M1Z'),
        },
      ],
      [
        'dell',
        {
          name: 'Dell India',
          isCustomer: false,
          isVendor: true,
          taxId: gstin('29AAACD4382A1Z'),
        },
      ],
    ] as const) {
      c[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
    const item = (
      await as()
        .post('/items', {
          name: 'Development',
          kind: 'service',
          hsnSac: '998314',
          salePrice: 500_000,
          incomeAccountId: acc.sales,
          taxGroupId: gst18,
        })
        .expect(201)
    ).body.id;
    kumarInvoice = await invoice(c.kumar, [
      {
        itemId: item,
        description: 'Development',
        quantity: 2,
        unitPrice: 500_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    await invoice(c.bluewave, [
      {
        description: 'App build',
        quantity: 1,
        unitPrice: 5_000_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    await invoice(c.walkin, [
      {
        description: 'Repair',
        quantity: 1,
        unitPrice: 200_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    const wrong = await invoice(c.walkin, [
      {
        description: 'Raised twice',
        quantity: 1,
        unitPrice: 100_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    await as()
      .post(`/invoices/${wrong.id}/void`, { date: '2026-05-11' })
      .expect(200);
    await invoice(c.big, [
      {
        description: 'Hardware setup',
        quantity: 1,
        unitPrice: 15_000_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    await invoice(c.northwind, [
      {
        description: 'Retainer',
        quantity: 1,
        unitPrice: 100_000,
        accountId: acc.sales,
      },
    ]);
    await as()
      .post('/credit-notes', {
        invoiceId: kumarInvoice.id,
        date: '2026-05-20',
        lines: [{ invoiceLineId: kumarInvoice.lines[0]!.id, quantity: '1' }],
      })
      .expect(201);
    await bill(c.sharma, 2_000_000);
    await bill(c.dell, 1_000_000);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [org, other] } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('GSTR-3B: tax on sales less credit on purchases, set off in the order the law gives', async () => {
    const g = (
      await as()
        .get('/reports/gst/gstr-3b?from=2026-05-01&to=2026-05-31')
        .expect(200)
    ).body;
    // Sales ₹2,12,000 taxed, less the ₹5,000 credit note; the voided invoice nets to nothing
    expect(g.outward).toEqual({
      taxable: 20_700_000,
      igst: 3_600_000,
      cgst: 63_000,
      sgst: 63_000,
      cess: 0,
    });
    expect(g.outwardUntaxed).toBe(9_000_000);
    expect(g.itc).toEqual({
      igst: 180_000,
      cgst: 180_000,
      sgst: 180_000,
      cess: 0,
    });
    // CGST and SGST credit pay their own heads first, then go to IGST; never to each other
    expect(g.payable).toEqual({ igst: 3_186_000, cgst: 0, sgst: 0, cess: 0 });
    expect(g.carriedForward).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('GSTR-1: registered buyers by GSTIN, the rest by state, exports, credit notes and HSN', async () => {
    const g = (
      await as()
        .get('/reports/gst/gstr-1?from=2026-05-01&to=2026-05-31')
        .expect(200)
    ).body;
    const rateRows = (items: Item[]) =>
      items.map((i) => [i.rate, i.taxable, i.igst, i.cgst, i.sgst]);
    expect(
      g.b2b.map((i: { name: string; placeOfSupply: string; items: Item[] }) => [
        i.name,
        i.placeOfSupply,
        rateRows(i.items),
      ]),
    ).toEqual([
      ['Kumar Logistics', '27', [[18, 1_000_000, 0, 90_000, 90_000]]],
      ['Bluewave Clinics', '29', [[18, 5_000_000, 900_000, 0, 0]]],
    ]);
    // An inter-state sale to an unregistered buyer over ₹1 lakh is listed on its own
    expect(
      g.b2cl.map((i: { placeOfSupply: string; value: number }) => [
        i.placeOfSupply,
        i.value,
      ]),
    ).toEqual([['29', 17_700_000]]);
    expect(g.b2cs).toEqual([
      {
        placeOfSupply: '27',
        type: 'intra',
        rate: 18,
        taxable: 200_000,
        igst: 0,
        cgst: 18_000,
        sgst: 18_000,
        cess: 0,
      },
    ]);
    expect(
      g.exports.map((i: { value: number; currency: string }) => [
        i.value,
        i.currency,
      ]),
    ).toEqual([[9_000_000, 'USD']]);
    expect(
      g.cdnr.map((n: { name: string; invoice: string; items: Item[] }) => [
        n.name,
        n.invoice,
        rateRows(n.items),
      ]),
    ).toEqual([
      [
        'Kumar Logistics',
        'INV/2026-27/0001',
        [[18, 500_000, 0, 45_000, 45_000]],
      ],
    ]);
    expect(
      g.hsn.find((h: { hsn: string }) => h.hsn === '998314'),
    ).toMatchObject({
      rate: 18,
      quantity: '1',
      taxable: 500_000,
      cgst: 45_000,
      sgst: 45_000,
    });
    expect(g.documents.invoices).toMatchObject({
      first: 'INV/2026-27/0001',
      last: 'INV/2026-27/0006',
      total: 6,
      cancelled: 1,
    });
  });

  it('exports GSTR-1 as CSV and as portal-shaped JSON, for India only', async () => {
    const csv = await as()
      .get('/reports/gst/gstr-1/export?from=2026-05-01&to=2026-05-31')
      .expect(200);
    const lines = csv.text
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines).toContain(
      `b2b,${gstin('29AAACB5678D1Z')},Bluewave Clinics,INV/2026-27/0002,2026-05-10,29,18,50000.00,9000.00,0.00,0.00,0.00`,
    );
    const json = JSON.parse(
      (
        await as()
          .get(
            '/reports/gst/gstr-1/export?from=2026-05-01&to=2026-05-31&format=json',
          )
          .expect(200)
      ).text,
    );
    expect(json.fp).toBe('052026');
    expect(
      json.b2b.find((x: { ctin: string }) => x.ctin === gstin('27AAKCK4821R1Z'))
        .inv[0],
    ).toMatchObject({
      inum: 'INV/2026-27/0001',
      idt: '10-05-2026',
      val: 11800,
      pos: '27',
    });
    expect(json.b2cs[0]).toMatchObject({
      sply_ty: 'INTRA',
      pos: '27',
      rt: 18,
      txval: 2000,
      camt: 180,
    });
    expect(
      (
        await as(() => other)
          .get('/reports/gst/gstr-3b?from=2026-05-01&to=2026-05-31')
          .expect(400)
      ).body.details.reason,
    ).toBe('not_india');
  });
});
