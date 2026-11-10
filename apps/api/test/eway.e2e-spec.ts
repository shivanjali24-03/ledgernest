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
const BLUEWAVE = gstin('29AAQFB7310K1Z');

describe('E-way bill JSON (e2e)', () => {
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
  let service = '';

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
          slug: `eway-${run}`,
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
          name: 'Dell Latitude 5440',
          kind: 'goods',
          unit: 'Nos',
          salePrice: 72_000_00,
          hsnSac: '84713010',
          taxGroupId: gst18,
          incomeAccountId: acc.sales,
        })
        .expect(201)
    ).body.id;
    service = (
      await as()
        .post('/items', {
          name: 'Installation',
          kind: 'service',
          salePrice: 5_000_00,
          hsnSac: '998732',
          taxGroupId: gst18,
          incomeAccountId: acc.sales,
        })
        .expect(201)
    ).body.id;
    for (const [key, body] of [
      [
        'bluewave',
        {
          name: 'Bluewave Clinics',
          legalName: 'Bluewave Clinics LLP',
          isCustomer: true,
          isVendor: false,
          taxId: BLUEWAVE,
          billingAddress: {
            line1: '80 Feet Road, Indiranagar',
            city: 'Bengaluru',
            region: 'Karnataka',
            postalCode: '560038',
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
    inv.bluewave = await issue(contact.bluewave, '2026-10-08', [
      {
        itemId: item,
        description: 'Dell Latitude 5440',
        quantity: '2',
        unitPrice: 72_000_00,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
      {
        itemId: service,
        description: 'Installation',
        quantity: '1',
        unitPrice: 5_000_00,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    inv.walkin = await issue(contact.walkin, '2026-10-09', [
      {
        itemId: item,
        description: 'Dell Latitude 5440',
        quantity: '1',
        unitPrice: 72_000_00,
        taxGroupId: gst18,
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

  it('makes the bulk-upload file from the goods, with IGST to another state and the vehicle as Part B', async () => {
    const r = await as()
      .post(`/invoices/${inv.bluewave}/e-way-bill`, {
        distanceKm: 840,
        vehicleNo: 'MH 12 AB 1234',
      })
      .expect(200);
    expect(r.headers['content-disposition']).toContain(
      'e-way-bill-inv-2026-27-0001.json',
    );
    const f = r.body as {
      version: string;
      billLists: Record<string, unknown>[];
    };
    expect(f.version).toBe('1.0.0621');
    expect(f.billLists[0]).toMatchObject({
      userGstin: OURS,
      docNo: 'INV/2026-27/0001',
      docDate: '08/10/2026',
      fromStateCode: 27,
      toGstin: BLUEWAVE,
      toStateCode: 29,
      toPincode: 560038,
      totalValue: 144000,
      igstValue: 25920,
      totInvValue: 169920,
      transMode: '1',
      vehicleNo: 'MH12AB1234',
      transDistance: '840',
      mainHsnCode: 84713010,
      itemList: [
        expect.objectContaining({
          hsnCode: 84713010,
          quantity: 2,
          igstRate: 18,
        }),
      ],
    });
  });

  it('says what to fix first, and checks the transport details', async () => {
    // The walk-in customer has no address: the goods can't be sent nowhere
    expect(
      (await as().post(`/invoices/${inv.walkin}/e-way-bill`, {}).expect(409))
        .body.details,
    ).toMatchObject({
      reason: 'eway_incomplete',
      problems: expect.arrayContaining([
        { code: 'address', party: 'buyer' },
        { code: 'pin', party: 'buyer' },
      ]),
    });
    await as()
      .post(`/invoices/${inv.bluewave}/e-way-bill`, { vehicleNo: '12' })
      .expect(400);
    expect(
      (
        await as()
          .post(`/invoices/${inv.bluewave}/e-way-bill`, { mode: 'rail' })
          .expect(409)
      ).body.details.problems,
    ).toEqual([{ code: 'transport_doc' }]);
  });
});
