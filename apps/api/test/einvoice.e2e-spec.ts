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
const OURS = gstin('27AAPFN1234C1Z');
const KUMAR = gstin('27AAKCK4821R1Z');
const BLUEWAVE = gstin('29AAQFB7310K1Z');

describe('GST e-invoice JSON (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let org = '';
  let gst18 = '';
  let item = '';

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
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const issue = async (
    contactId: string,
    issueDate: string,
    lines: object[],
  ) => {
    const d = (
      await as().post('/invoices', { contactId, issueDate, lines }).expect(201)
    ).body as { id: string };
    await as().post(`/invoices/${d.id}/issue`).expect(200);
    return d.id;
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
          name: 'Nest Demo',
          legalName: `Nest Demo Private Limited ${run}`,
          slug: `einvoice-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: OURS,
          addressLine1: '4th Floor, Riverside Business Bay',
          city: 'Pune',
          postalCode: '411045',
          phone: '+91 20 4000 1234',
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
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    item = (
      await as()
        .post('/items', {
          name: 'Software development',
          kind: 'service',
          unit: 'hrs',
          salePrice: 2_500_00,
          hsnSac: '998314',
          taxGroupId: gst18,
          incomeAccountId: acc.sales,
        })
        .expect(201)
    ).body.id;
    for (const [key, body] of [
      [
        'kumar',
        {
          name: 'Kumar Logistics',
          legalName: 'Kumar Logistics Private Limited',
          isCustomer: true,
          isVendor: false,
          taxId: KUMAR,
          billingAddress: {
            line1: 'Plot 18, Hinjewadi Phase 2',
            city: 'Pune',
            region: 'Maharashtra',
            postalCode: '411057',
            country: 'IN',
          },
        },
      ],
      [
        'bluewave',
        {
          name: 'Bluewave Clinics',
          isCustomer: true,
          isVendor: false,
          taxId: BLUEWAVE,
          // No PIN code: the portal would refuse it
          billingAddress: {
            line1: '80 Feet Road',
            city: 'Bengaluru',
            region: 'Karnataka',
            country: 'IN',
          },
        },
      ],
      [
        'walkin',
        { name: 'Walk-in customer', isCustomer: true, isVendor: false },
      ],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
    // 40 hours at ₹2,500 less 10%, CGST + SGST within Maharashtra
    inv.kumar = await issue(contact.kumar, '2026-10-05', [
      {
        itemId: item,
        description: 'Software development, sprint 14',
        quantity: '40',
        unitPrice: 2_500_00,
        discount: 10,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    inv.bluewave = await issue(contact.bluewave, '2026-10-08', [
      {
        itemId: item,
        description: 'Support',
        quantity: '10',
        unitPrice: 2_500_00,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    inv.walkin = await issue(contact.walkin, '2026-10-09', [
      {
        description: 'Consulting',
        quantity: '1',
        unitPrice: 5_000_00,
        accountId: acc.sales,
      },
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('downloads an invoice as the portal’s JSON', async () => {
    const r = await as().get(`/invoices/${inv.kumar}/e-invoice`).expect(200);
    expect(r.headers['content-disposition']).toContain(
      'e-invoice-inv-2026-27-0001.json',
    );
    expect(r.body).toMatchObject({
      Version: '1.1',
      TranDtls: { SupTyp: 'B2B' },
      DocDtls: { Typ: 'INV', No: 'INV/2026-27/0001', Dt: '05/10/2026' },
      SellerDtls: {
        Gstin: OURS,
        LglNm: `Nest Demo Private Limited ${run}`,
        TrdNm: 'Nest Demo',
        Pin: 411045,
        Stcd: '27',
        Loc: 'Pune',
      },
      BuyerDtls: {
        Gstin: KUMAR,
        LglNm: 'Kumar Logistics Private Limited',
        Pin: 411057,
        Pos: '27',
      },
      ItemList: [
        {
          HsnCd: '998314',
          IsServc: 'Y',
          Qty: 40,
          UnitPrice: 2500,
          TotAmt: 100000,
          Discount: 10000,
          AssAmt: 90000,
          GstRt: 18,
          CgstAmt: 8100,
          SgstAmt: 8100,
          IgstAmt: 0,
          TotItemVal: 106200,
        },
      ],
      ValDtls: {
        AssVal: 90000,
        CgstVal: 8100,
        SgstVal: 8100,
        TotInvVal: 106200,
      },
    });
    // Viewers only see reports
    await as('viewer').get(`/invoices/${inv.kumar}/e-invoice`).expect(403);
  });

  it('says what to fix when the portal would refuse it', async () => {
    expect(
      (await as().get(`/invoices/${inv.bluewave}/e-invoice`).expect(409)).body
        .details,
    ).toEqual({
      reason: 'einvoice_incomplete',
      problems: [{ code: 'pin', party: 'buyer' }],
    });
    const walkin = (
      await as().get(`/invoices/${inv.walkin}/e-invoice`).expect(409)
    ).body.details.problems as { code: string }[];
    expect(walkin).toEqual(
      expect.arrayContaining([
        { code: 'gstin', party: 'buyer' },
        { code: 'hsn', line: 1 },
      ]),
    );
  });

  it('gathers a month’s B2B invoices for the bulk upload, listing those that need fixing', async () => {
    const r = (
      await as()
        .get('/invoices/e-invoice?from=2026-10-01&to=2026-10-31')
        .expect(200)
    ).body as {
      invoices: { DocDtls: { No: string } }[];
      skipped: { number: string; problems: { code: string }[] }[];
    };
    // The walk-in customer has no GSTIN: not B2B, so not there at all
    expect(r.invoices.map((i) => i.DocDtls.No)).toEqual(['INV/2026-27/0001']);
    expect(r.skipped).toEqual([
      expect.objectContaining({
        number: 'INV/2026-27/0002',
        problems: [{ code: 'pin', party: 'buyer' }],
      }),
    ]);
    await as()
      .get('/invoices/e-invoice?from=2026-10-31&to=2026-10-01')
      .expect(400);
    // Once the PIN is added, it's ready
    await as()
      .patch(`/contacts/${contact.bluewave}`, {
        billingAddress: {
          line1: '80 Feet Road',
          city: 'Bengaluru',
          region: 'Karnataka',
          postalCode: '560034',
          country: 'IN',
        },
      })
      .expect(200);
    const fixed = (
      await as().get(`/invoices/${inv.bluewave}/e-invoice`).expect(200)
    ).body;
    // Karnataka buyer, place of supply Karnataka: IGST
    expect(fixed).toMatchObject({
      BuyerDtls: { Stcd: '29', Pos: '29', Pin: 560034 },
      ValDtls: { IgstVal: 4500, CgstVal: 0, TotInvVal: 29500 },
    });
  });

  it('runs a GST health check: what would go wrong when filing, with examples to fix', async () => {
    await as()
      .post('/items', {
        name: 'Packing material',
        kind: 'goods',
        incomeAccountId: acc.sales,
      })
      .expect(201);
    const r = (await as().get('/reports/gst/health').expect(200)).body as {
      checked: boolean;
      issues: { kind: string; count: number; sample: { name: string }[] }[];
    };
    expect(r.checked).toBe(true);
    // The organisation is complete; the walk-in customer has no state, the new item no HSN
    expect(r.issues.map((i) => i.kind).sort()).toEqual([
      'customers_state',
      'items_hsn',
    ]);
    expect(r.issues.find((i) => i.kind === 'items_hsn')).toMatchObject({
      count: 1,
      sample: [expect.objectContaining({ name: 'Packing material' })],
    });
    expect(r.issues.find((i) => i.kind === 'customers_state')!.sample).toEqual([
      expect.objectContaining({ name: 'Walk-in customer' }),
    ]);
    // A PIN code gone: the organisation's address is flagged
    await prisma.organization.update({
      where: { id: org },
      data: { postalCode: null },
    });
    expect(
      (
        (await as().get('/reports/gst/health').expect(200)).body as {
          issues: { kind: string }[];
        }
      ).issues.map((i) => i.kind),
    ).toContain('org_address');
  });

  it('says on a tax invoice whether reverse charge applies, with a place for the signature', async () => {
    const r = await as()
      .get(`/invoices/${inv.kumar}/pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const text = (r.body as Buffer).toString('latin1');
    expect(text).toContain('(Tax invoice INV/2026-27/');
    expect(text).toContain('(Whether tax is payable on reverse charge: No) Tj');
    expect(text).toContain(`(For Nest Demo Private Limited ${run}) Tj`);
    expect(text).toContain('(Authorised signatory) Tj');
  });

  it('records the IRN the portal gave, and prints it with the signed QR code; clears it if cancelled', async () => {
    const irn =
      'a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229';
    const signedQrCode =
      'eyJhbGciOiJSUzI1NiJ9.eyJJcm4iOiJhNWMxMiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    await as('viewer')
      .put(`/invoices/${inv.kumar}/irn`, {
        irn,
        ackNo: '112610036563310',
        ackDate: '2026-10-06 11:05:00',
        signedQrCode,
      })
      .expect(403);
    await as()
      .put(`/invoices/${inv.kumar}/irn`, {
        irn: 'nope',
        ackNo: '1',
        ackDate: 'x',
        signedQrCode: 'y',
      })
      .expect(400);
    const saved = (
      await as()
        .put(`/invoices/${inv.kumar}/irn`, {
          irn: irn.toUpperCase(),
          ackNo: '112610036563310',
          ackDate: '2026-10-06 11:05:00',
          signedQrCode,
        })
        .expect(200)
    ).body as { irn: { irn: string; ackNo: string } };
    expect(saved.irn).toEqual({
      irn,
      ackNo: '112610036563310',
      ackDate: '2026-10-06 11:05:00',
    });
    const pdf = await as()
      .get(`/invoices/${inv.kumar}/pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain(`(IRN ${irn.slice(0, 32)}) Tj`);
    expect(text).toContain(`(${irn.slice(32)}) Tj`);
    expect(text).toContain(
      '(Ack No 112610036563310 · Ack date 2026-10-06 11:05:00) Tj',
    );
    expect(text).toContain('(e-Invoice QR) Tj');
    const cleared = (
      await as().delete(`/invoices/${inv.kumar}/irn`).expect(200)
    ).body as { irn: unknown };
    expect(cleared.irn).toBeNull();
  });
});
