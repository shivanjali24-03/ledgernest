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
type Inv = {
  id: string;
  supplyKind: string;
  placeOfSupply: string | null;
  taxTotal: number;
  lines: { taxGroup: { name: string } | null }[];
};

describe('Exports and SEZ supplies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let sales = '';
  let gst18 = '';
  let buyerAbroad = '';
  let sezUnit = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const draft = (contactId: string, supplyKind: string, extra: object = {}) =>
    post('/invoices', {
      contactId,
      issueDate: '2026-06-10',
      supplyKind,
      lines: [
        {
          description: 'Software development',
          quantity: 1,
          unitPrice: 1_00_000_00,
          taxGroupId: gst18,
          accountId: sales,
        },
      ],
      ...extra,
    });

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
          name: `Exports ${run}`,
          slug: `exports-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
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
      code: '1200',
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
    gst18 = (
      (await post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    buyerAbroad = (
      await post('/contacts', {
        name: 'Northwind Inc.',
        isCustomer: true,
        isVendor: false,
        billingAddress: {
          line1: '500 Congress Ave',
          city: 'Austin',
          country: 'US',
        },
      }).expect(201)
    ).body.id;
    sezUnit = (
      await post('/contacts', {
        name: 'Magarpatta SEZ Unit',
        isCustomer: true,
        isVendor: false,
        taxId: gstin('27AABCM1234K1Z'),
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

  it('exports without IGST only under a letter of undertaking covering the date, and charges no tax', async () => {
    expect(
      (await draft(buyerAbroad, 'export_lut').expect(400)).body.details,
    ).toMatchObject({ reason: 'no_lut' });
    await patch('/organization', {
      lutNumber: 'AD2704260012345',
      lutFrom: '2026-04-01',
      lutTo: '2027-03-31',
    }).expect(200);
    expect(
      (await get('/organization').expect(200)).body.organization,
    ).toMatchObject({
      lutNumber: 'AD2704260012345',
      lutFrom: '2026-04-01',
      lutTo: '2027-03-31',
    });
    const inv = (
      await draft(buyerAbroad, 'export_lut', {
        exportDetails: {
          portCode: 'INBOM4',
          shippingBillNo: '7712345',
          shippingBillDate: '2026-06-12',
          countryCode: 'US',
        },
      }).expect(201)
    ).body as Inv;
    expect(inv).toMatchObject({
      supplyKind: 'export_lut',
      placeOfSupply: null,
      taxTotal: 0,
    });
    expect(inv.lines[0]!.taxGroup).toBeNull();
    await post(`/invoices/${inv.id}/issue`).expect(200);
    const pdf = await get(`/invoices/${inv.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('without payment of IGST \\(LUT AD2704260012345\\)');
    expect(text).toContain('Shipping bill 7712345 dated 2026-06-12');
  });

  it('charges IGST on a supply to an SEZ unit in the same state, and on an export with payment', async () => {
    const sez = (await draft(sezUnit, 'sez_with_igst').expect(201)).body as Inv;
    expect(sez.lines[0]!.taxGroup?.name).toBe('IGST 18%');
    expect(sez.taxTotal).toBe(18_000_00);
    await post(`/invoices/${sez.id}/issue`).expect(200);
    const wp = (await draft(buyerAbroad, 'export_with_igst').expect(201))
      .body as Inv;
    expect(wp.lines[0]!.taxGroup?.name).toBe('IGST 18%');
    await post(`/invoices/${wp.id}/issue`).expect(200);
  });

  it('files them in GSTR-1: exports with or without IGST and their shipping bills, SEZ supplies as SEWP', async () => {
    const res = await get(
      '/reports/gst/gstr-1/export?from=2026-06-01&to=2026-06-30&format=json',
    ).expect(200);
    const j = JSON.parse(res.text) as {
      exp: { exp_typ: string; inv: { sbpcode?: string; sbnum?: string }[] }[];
      b2b: { inv: { inv_typ: string }[] }[];
    };
    expect(j.exp.map((x) => x.exp_typ).sort()).toEqual(['WOPAY', 'WPAY']);
    expect(j.exp.find((x) => x.exp_typ === 'WOPAY')!.inv[0]).toMatchObject({
      sbpcode: 'INBOM4',
      sbnum: '7712345',
    });
    expect(j.b2b.flatMap((c) => c.inv.map((i) => i.inv_typ))).toEqual(['SEWP']);
  });
});
