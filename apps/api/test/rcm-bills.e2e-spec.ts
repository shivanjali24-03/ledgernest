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
type Bill = {
  id: string;
  total: number;
  taxTotal: number;
  reverseCharge: boolean;
  selfInvoiceNumber: string | null;
  reverseChargeTax: { name: string; amount: number }[];
  lines: {
    taxGroup: { name: string } | null;
    rcmTaxGroup: { name: string } | null;
  }[];
};

describe('Reverse charge on purchases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let gst5 = '';
  let gta = '';
  let lawyer = '';
  let abroad = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const bill = (contactId: string, unitPrice: number, group: string) =>
    post('/bills', {
      contactId,
      billDate: '2026-06-10',
      reverseCharge: true,
      vendorReference: `R-${unitPrice}`,
      lines: [
        {
          description: 'Service',
          quantity: 1,
          unitPrice,
          taxGroupId: group,
          accountId: expense,
        },
      ],
    });
  const entryOf = async (billId: string) => {
    const { journalEntryId } = await prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      select: { journalEntryId: true },
    });
    return prisma.journalLine.findMany({
      where: { entryId: journalEntryId! },
      select: {
        debit: true,
        credit: true,
        account: { select: { code: true, systemKey: true } },
      },
    });
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
          name: `RCM bills ${run}`,
          slug: `rcm-bills-${run}`,
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
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst18 = groups.find((g) => g.name === 'GST 18%')!.id;
    gst5 = groups.find((g) => g.name === 'GST 5%')!.id;
    await post('/accounts', {
      name: `creditors ${run}`,
      code: '2000',
      type: 'liability',
      subtype: 'accounts_payable',
    }).expect(201);
    await post('/currencies', { code: 'USD' }).expect(201);
    await auth(http().put('/api/v1/currencies/USD/rates/2026-06-01'))
      .send({ rate: '85' })
      .expect(200);
    await post('/accounts', {
      name: `usd creditors ${run}`,
      code: '2050',
      type: 'liability',
      subtype: 'accounts_payable',
      currency: 'USD',
    }).expect(201);
    expense = (
      await post('/accounts', {
        name: `freight ${run}`,
        code: '5100',
        type: 'expense',
        subtype: 'operating_expense',
      }).expect(201)
    ).body.id;
    const vendor = async (body: object) =>
      (
        await post('/contacts', {
          isCustomer: false,
          isVendor: true,
          ...body,
        }).expect(201)
      ).body.id as string;
    gta = await vendor({
      name: 'Shree Roadways',
      taxId: gstin('27AABFS1234K1Z'),
    });
    lawyer = await vendor({
      name: 'Adv. R. Kulkarni',
      billingAddress: { city: 'Pune', region: 'Maharashtra', country: 'IN' },
    });
    abroad = await vendor({ name: 'Figma Inc.', currency: 'USD' });
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const sum = (
    lines: Awaited<ReturnType<typeof entryOf>>,
    f: (l: Awaited<ReturnType<typeof entryOf>>[number]) => boolean,
    side: 'debit' | 'credit',
  ) => lines.filter(f).reduce((s, l) => s + Number(l[side]), 0);

  it('pays transport from a registered GTA without GST to them, taking the credit against GST owed under reverse charge', async () => {
    const b = (await bill(gta, 10_000_00, gst5).expect(201)).body as Bill;
    expect(b).toMatchObject({
      reverseCharge: true,
      taxTotal: 0,
      total: 10_000_00,
    });
    expect(b.lines[0]!.taxGroup).toBeNull();
    expect(b.lines[0]!.rcmTaxGroup?.name).toBe('GST 5%');
    expect(b.reverseChargeTax).toEqual([
      { name: 'CGST 2.5%', amount: 250_00 },
      { name: 'SGST 2.5%', amount: 250_00 },
    ]);
    const rec = (await post(`/bills/${b.id}/record`).expect(200)).body as Bill;
    // Registered supplier: they issue the invoice, so no self-invoice
    expect(rec.selfInvoiceNumber).toBeNull();
    const lines = await entryOf(b.id);
    expect(sum(lines, (l) => l.account.code === '2000', 'credit')).toBe(
      10_000_00,
    );
    expect(
      sum(lines, (l) => l.account.systemKey === 'rcm_payable', 'credit'),
    ).toBe(500_00);
    expect(sum(lines, (l) => l.account.code === '5100', 'debit')).toBe(
      10_000_00,
    );
    // Input credit: CGST and SGST input
    expect(sum(lines, () => true, 'debit')).toBe(10_500_00);
    await get(`/bills/${b.id}/self-invoice`).expect(409);
  });

  it('raises a numbered self-invoice for an unregistered supplier', async () => {
    const b = (await bill(lawyer, 20_000_00, gst18).expect(201)).body as Bill;
    const rec = (await post(`/bills/${b.id}/record`).expect(200)).body as Bill;
    expect(rec.selfInvoiceNumber).toBe('SI/2026-27/0001');
    const pdf = await get(`/bills/${b.id}/self-invoice`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('Self invoice SI/2026-27/0001');
    expect(text).toContain('Whether tax is payable on reverse charge: Yes');
    expect(text).toContain('3600.00');
    const next = (await bill(lawyer, 1_000_00, gst18).expect(201)).body as Bill;
    expect(
      ((await post(`/bills/${next.id}/record`).expect(200)).body as Bill)
        .selfInvoiceNumber,
    ).toBe('SI/2026-27/0002');
  });

  it('treats services bought from abroad as an import: IGST in rupees at the bill’s rate', async () => {
    const b = (await bill(abroad, 100_00, gst18).expect(201)).body as Bill;
    expect(b.lines[0]!.rcmTaxGroup?.name).toBe('IGST 18%');
    const rec = (await post(`/bills/${b.id}/record`).expect(200)).body as Bill;
    expect(rec.selfInvoiceNumber).toBe('SI/2026-27/0003');
    const lines = await entryOf(b.id);
    // $100 at 85 = ₹8,500; IGST 18% = ₹1,530
    expect(
      sum(lines, (l) => l.account.systemKey === 'rcm_payable', 'credit'),
    ).toBe(1_530_00);
    expect(sum(lines, (l) => l.account.code === '5100', 'debit')).toBe(
      8_500_00,
    );
  });

  it('reports it in GSTR-3B 3.1(d), payable in cash, with the credit in 4(A)', async () => {
    const r = (
      await get('/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30').expect(
        200,
      )
    ).body as {
      inwardReverseCharge: {
        taxable: number;
        igst: number;
        cgst: number;
        sgst: number;
      };
      itc: { igst: number; cgst: number; sgst: number };
      payable: { igst: number; cgst: number; sgst: number };
    };
    // 10,000 at 5% + 21,000 at 18% (local) + 8,500 at 18% IGST
    expect(r.inwardReverseCharge).toMatchObject({
      taxable: 39_500_00,
      cgst: 250_00 + 1_890_00,
      sgst: 250_00 + 1_890_00,
      igst: 1_530_00,
    });
    expect(r.itc).toMatchObject({
      cgst: 2_140_00,
      sgst: 2_140_00,
      igst: 1_530_00,
    });
    // No sales, so the credit is carried forward and the reverse charge GST paid in cash
    expect(r.payable).toMatchObject({
      cgst: 2_140_00,
      sgst: 2_140_00,
      igst: 1_530_00,
    });
  });

  it('refuses a debit note against a reverse-charge bill', async () => {
    const b = (await bill(gta, 5_000_00, gst5).expect(201)).body as Bill & {
      lines: { id: string }[];
    };
    await post(`/bills/${b.id}/record`).expect(200);
    const res = await post('/debit-notes', {
      billId: b.id,
      date: '2026-06-20',
      reason: 'Short delivery',
      lines: [{ billLineId: b.lines[0]!.id, quantity: '1' }],
    }).expect(400);
    expect(res.body.details).toMatchObject({ reason: 'bill_reverse_charge' });
  });
});
