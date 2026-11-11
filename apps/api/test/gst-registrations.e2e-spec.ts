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
const OWN = gstin('27AAPFN1234C1Z');
const GUJARAT = gstin('24AAPFN1234C1Z');

type Inv = {
  id: string;
  taxBreakdown: { name: string; amount: number }[];
  gstRegistration: { gstin: string } | null;
};

/** One business, GSTINs in two states: each document under one, taxed and filed with it */
describe('GST registrations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let sales = '';
  let gst18 = '';
  let surat = '';
  let guj = '';
  let service = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const invoice = async (registrationId: string | null, price: number) => {
    const inv = (
      await post('/invoices', {
        contactId: surat,
        issueDate: '2026-06-10',
        gstRegistrationId: registrationId,
        lines: [
          {
            itemId: service,
            description: 'Textile machinery service',
            quantity: 1,
            unitPrice: price,
            taxGroupId: gst18,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as Inv;
    await post(`/invoices/${inv.id}/issue`).expect(200);
    return (await get(`/invoices/${inv.id}`).expect(200)).body as Inv;
  };

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
          name: `GST regs ${run}`,
          slug: `gst-regs-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: OWN,
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
    gst18 = (
      (await post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    service = (
      await post('/items', {
        name: 'Machinery service',
        kind: 'service',
        hsnSac: '998719',
      }).expect(201)
    ).body.id;
    surat = (
      await post('/contacts', {
        name: 'Surat Weaving Mills',
        isCustomer: true,
        isVendor: false,
        taxId: gstin('24ABZPS6519M1Z'),
        billingAddress: {
          line1: 'Ring Road',
          city: 'Surat',
          postalCode: '395002',
        },
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

  it('adds a GSTIN in another state under the same PAN, and only such', async () => {
    const reasons = async (body: object) =>
      (await post('/gst-registrations', body)).body.details?.reason as string;
    expect(await reasons({ gstin: OWN })).toBe('gstin_is_organisation');
    expect(await reasons({ gstin: gstin('24AABCU9603R1Z') })).toBe(
      'gstin_other_pan',
    );
    const r = (
      await post('/gst-registrations', {
        gstin: GUJARAT.toLowerCase(),
        tradeName: 'Nest Gujarat',
        address: {
          line1: 'GIDC Sachin',
          city: 'Surat',
          region: 'Gujarat',
          postalCode: '394230',
        },
      }).expect(201)
    ).body as { id: string; stateCode: string; state: string };
    expect(r).toMatchObject({ stateCode: '24', state: 'Gujarat' });
    guj = r.id;
    expect(await reasons({ gstin: GUJARAT })).toBe('gstin_taken');
    const list = (await get('/gst-registrations').expect(200)).body as {
      primary: { gstin: string };
      registrations: { gstin: string }[];
    };
    expect(list.primary.gstin).toBe(OWN);
    expect(list.registrations.map((x) => x.gstin)).toEqual([GUJARAT]);
  });

  it('taxes a sale by the GSTIN it’s under: within Gujarat CGST and SGST, from Maharashtra IGST', async () => {
    const local = await invoice(guj, 1_00_000_00);
    expect(local.gstRegistration?.gstin).toBe(GUJARAT);
    expect(local.taxBreakdown.map((t) => t.name).sort()).toEqual([
      'CGST 9%',
      'SGST 9%',
    ]);
    const fromPune = await invoice(null, 50_000_00);
    expect(fromPune.taxBreakdown.map((t) => t.name)).toEqual(['IGST 18%']);
    // The Gujarat GSTIN prints as the supplier
    const pdf = (
      (
        await get(`/invoices/${local.id}/pdf`)
          .buffer(true)
          .parse((res, cb) => {
            const c: Buffer[] = [];
            res.on('data', (x: Buffer) => c.push(x));
            res.on('end', () => cb(null, Buffer.concat(c)));
          })
          .expect(200)
      ).body as Buffer
    ).toString('latin1');
    expect(pdf).toContain(`Nest Gujarat · GSTIN ${GUJARAT}`);
    const e = (await get(`/invoices/${local.id}/e-invoice`).expect(200))
      .body as { SellerDtls: { Gstin: string; Pin: number } };
    expect(e.SellerDtls).toMatchObject({ Gstin: GUJARAT, Pin: 394230 });
  });

  it('files each GSTIN’s returns apart', async () => {
    const r1 = async (q: string) =>
      (
        await get(
          `/reports/gst/gstr-1?from=2026-06-01&to=2026-06-30${q}`,
        ).expect(200)
      ).body as { gstin: string; b2b: { inv: unknown[] }[] };
    const gujR1 = await r1(`&registrationId=${guj}`);
    expect(gujR1.gstin).toBe(GUJARAT);
    expect(gujR1.b2b.flatMap((c) => c.inv)).toHaveLength(1);
    expect((await r1('')).b2b.flatMap((c) => c.inv)).toHaveLength(1);
    const r3 = async (q: string) =>
      (
        await get(
          `/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30${q}`,
        ).expect(200)
      ).body as {
        gstin: string;
        outward: { taxable: number; igst: number; cgst: number; sgst: number };
      };
    expect(await r3(`&registrationId=${guj}`)).toMatchObject({
      gstin: GUJARAT,
      outward: {
        taxable: 1_00_000_00,
        igst: 0,
        cgst: 9_000_00,
        sgst: 9_000_00,
      },
    });
    expect((await r3('')).outward).toMatchObject({
      taxable: 50_000_00,
      igst: 9_000_00,
      cgst: 0,
    });
  });

  it('archives a GSTIN: no new documents under it, its returns still there', async () => {
    await post(`/gst-registrations/${guj}/archive`).expect(204);
    expect(
      (
        await post('/invoices', {
          contactId: surat,
          issueDate: '2026-06-20',
          gstRegistrationId: guj,
          lines: [
            {
              description: 'x',
              quantity: 1,
              unitPrice: 1_00,
              accountId: sales,
            },
          ],
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'registration_invalid' });
    await get(
      `/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30&registrationId=${guj}`,
    ).expect(200);
  });
});
