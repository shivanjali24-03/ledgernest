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
  reverseCharge: boolean;
  taxTotal: number;
  total: number;
  reverseChargeTax: { name: string; amount: number }[];
  lines: {
    taxGroup: { name: string } | null;
    rcmTaxGroup: { name: string } | null;
  }[];
};

describe('Reverse charge on sales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let sales = '';
  let gst18 = '';
  let gst5 = '';
  let buyerAbroad = '';
  let sezUnit = '';
  let shop = '';
  let gta = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const draft = (contactId: string, extra: object = {}) =>
    post('/invoices', {
      contactId,
      issueDate: '2026-06-10',
      reverseCharge: true,
      lines: [
        {
          description: 'Goods transport (GTA)',
          quantity: 1,
          unitPrice: 50_000_00,
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
          name: `RCM ${run}`,
          slug: `rcm-${run}`,
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
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst18 = groups.find((g) => g.name === 'GST 18%')!.id;
    gst5 = groups.find((g) => g.name === 'GST 5%')!.id;
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
        name: 'Bharat Cement Ltd',
        isCustomer: true,
        isVendor: false,
        taxId: gstin('27AABCB1234K1Z'),
        billingAddress: {
          line1: 'Survey 12, Talegaon',
          city: 'Pune',
          region: 'Maharashtra',
          postalCode: '410506',
          country: 'IN',
        },
      }).expect(201)
    ).body.id;
    gta = (
      await post('/items', {
        name: 'Goods transport',
        kind: 'service',
        hsnSac: '996791',
        taxGroupId: gst5,
        incomeAccountId: sales,
      }).expect(201)
    ).body.id;
    shop = (
      await post('/contacts', {
        name: 'Corner Shop',
        isCustomer: true,
        isVendor: false,
        billingAddress: { city: 'Pune', region: 'Maharashtra', country: 'IN' },
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

  it('refuses reverse charge to an unregistered buyer, and on an export', async () => {
    expect((await draft(shop).expect(400)).body.details).toMatchObject({
      reason: 'rcm_unregistered',
    });
    expect(
      (await draft(buyerAbroad, { supplyKind: 'export_with_igst' }).expect(400))
        .body.details,
    ).toMatchObject({ reason: 'rcm_kind' });
  });

  let rcmId = '';
  it('charges no GST, keeping the rate to show the tax the buyer pays', async () => {
    const inv = (
      await draft(sezUnit, {
        lines: [
          {
            itemId: gta,
            description: 'Goods transport (GTA)',
            quantity: 1,
            unitPrice: 50_000_00,
            taxGroupId: gst5,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as Inv;
    rcmId = inv.id;
    expect(inv).toMatchObject({
      reverseCharge: true,
      taxTotal: 0,
      total: 50_000_00,
    });
    expect(inv.lines[0]!.taxGroup).toBeNull();
    expect(inv.lines[0]!.rcmTaxGroup?.name).toBe('GST 5%');
    expect(inv.reverseChargeTax).toEqual([
      { name: 'CGST 2.5%', amount: 1_250_00 },
      { name: 'SGST 2.5%', amount: 1_250_00 },
    ]);
    await post(`/invoices/${inv.id}/issue`).expect(200);
    // Nothing goes to output tax: the entry is the receivable against sales
    const { journalEntryId } = await prisma.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      select: { journalEntryId: true },
    });
    const entry = await prisma.journalLine.findMany({
      where: { entryId: journalEntryId! },
      select: { debit: true, credit: true },
    });
    expect(entry.reduce((s, l) => s + Number(l.credit), 0)).toBe(50_000_00);
    expect(entry).toHaveLength(2);
    const pdf = await get(`/invoices/${inv.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('Whether tax is payable on reverse charge: Yes');
    expect(text).toContain(
      'GST payable by the recipient: CGST 2.5% INR 1250.00',
    );
  });

  it('files it in GSTR-1 as B2B with reverse charge and the tax, leaves it out of GSTR-3B output tax, and marks the e-invoice', async () => {
    // An ordinary invoice alongside
    const plain = (
      await post('/invoices', {
        contactId: sezUnit,
        issueDate: '2026-06-11',
        lines: [
          {
            description: 'Cement',
            quantity: 1,
            unitPrice: 10_000_00,
            taxGroupId: gst18,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body as Inv;
    await post(`/invoices/${plain.id}/issue`).expect(200);
    const res = await get(
      '/reports/gst/gstr-1/export?from=2026-06-01&to=2026-06-30&format=json',
    ).expect(200);
    const j = JSON.parse(res.text) as {
      b2b: {
        inv: {
          rchrg: string;
          val: number;
          itms: { itm_det: { rt: number; txval: number; camt: number } }[];
        }[];
      }[];
    };
    const invs = j.b2b.flatMap((c) => c.inv);
    const rcm = invs.find((i) => i.rchrg === 'Y')!;
    expect(rcm.val).toBe(50_000);
    expect(rcm.itms[0]!.itm_det).toMatchObject({
      rt: 5,
      txval: 50_000,
      camt: 1250,
    });
    expect(invs.filter((i) => i.rchrg === 'N')).toHaveLength(1);
    const b3 = (
      await get('/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30').expect(
        200,
      )
    ).body as { outward: { taxable: number; cgst: number } };
    expect(b3.outward).toMatchObject({ taxable: 10_000_00, cgst: 900_00 });
    const e = (await get(`/invoices/${rcmId}/e-invoice`).expect(200)).body as {
      TranDtls: { RegRev: string };
      ItemList: { GstRt: number; CgstAmt: number }[];
    };
    expect(e.TranDtls.RegRev).toBe('Y');
    expect(e.ItemList[0]).toMatchObject({ GstRt: 5, CgstAmt: 1250 });
  });
});
