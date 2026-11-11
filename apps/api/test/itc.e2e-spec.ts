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
  lines: { itc: string; taxGroup: { name: string } | null }[];
};

describe('Input tax credit eligibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let gst5 = '';
  let vendor = '';
  let lunch = '';
  let car = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const bill = (lines: object[]) =>
    post('/bills', {
      contactId: vendor,
      billDate: '2026-06-10',
      vendorReference: `V-${randomUUID().slice(0, 6)}`,
      lines,
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
          name: `ITC ${run}`,
          slug: `itc-${run}`,
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
    const account = async (code: string, type: string, subtype: string) =>
      (
        await post('/accounts', {
          name: `${code} ${run}`,
          code,
          type,
          subtype,
        }).expect(201)
      ).body.id as string;
    expense = await account('5100', 'expense', 'operating_expense');
    const stock = await account('1500', 'asset', 'inventory');
    const cogs = await account('5000', 'expense', 'cost_of_sales');
    vendor = (
      await post('/contacts', {
        name: 'Hotel Shreyas',
        isCustomer: false,
        isVendor: true,
        taxId: gstin('27AABFH1234K1Z'),
      }).expect(201)
    ).body.id;
    lunch = (
      await post('/items', {
        name: 'Staff lunch',
        kind: 'service',
        itcBlocked: true,
        taxGroupId: gst5,
        expenseAccountId: expense,
      }).expect(201)
    ).body.id;
    car = (
      await post('/items', {
        name: 'Company car',
        kind: 'goods',
        trackStock: true,
        inventoryAccountId: stock,
        cogsAccountId: cogs,
        taxGroupId: gst18,
        itcBlocked: true,
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

  const debits = (lines: Awaited<ReturnType<typeof entryOf>>, code: string) =>
    lines
      .filter((l) => l.account.code === code)
      .reduce((s, l) => s + Number(l.debit), 0);

  it('books blocked credit (s.17(5)) as cost: the item says so, whatever the line asks', async () => {
    const b = (
      await bill([
        {
          itemId: lunch,
          description: 'Staff lunch, June',
          quantity: 1,
          unitPrice: 10_000_00,
          taxGroupId: gst5,
          itc: 'eligible',
        },
      ]).expect(201)
    ).body as Bill;
    expect(b.lines[0]!.itc).toBe('blocked');
    // The vendor still charged GST
    expect(b).toMatchObject({ taxTotal: 500_00, total: 10_500_00 });
    await post(`/bills/${b.id}/record`).expect(200);
    const lines = await entryOf(b.id);
    expect(debits(lines, '5100')).toBe(10_500_00);
    // No input credit lines
    expect(lines.filter((l) => Number(l.debit) > 0)).toHaveLength(1);
  });

  it('takes credit on eligible lines only, and books ineligible GST as cost', async () => {
    const b = (
      await bill([
        {
          description: 'Printer paper',
          quantity: 1,
          unitPrice: 1_000_00,
          taxGroupId: gst18,
          accountId: expense,
        },
        {
          description: 'Gift hampers for customers',
          quantity: 1,
          unitPrice: 2_000_00,
          taxGroupId: gst18,
          accountId: expense,
          itc: 'ineligible',
        },
      ]).expect(201)
    ).body as Bill;
    await post(`/bills/${b.id}/record`).expect(200);
    const lines = await entryOf(b.id);
    // 1,000 + 2,000 + 360 GST on the gifts as cost; 180 credit on the paper
    expect(debits(lines, '5100')).toBe(3_360_00);
    expect(
      lines
        .filter((l) => l.account.code !== '5100')
        .reduce((s, l) => s + Number(l.debit), 0),
    ).toBe(180_00);
  });

  it('puts blocked GST into what stock cost', async () => {
    const b = (
      await bill([
        {
          itemId: car,
          description: 'Sedan for the director',
          quantity: 1,
          unitPrice: 10_00_000_00,
          taxGroupId: gst18,
        },
      ]).expect(201)
    ).body as Bill;
    await post(`/bills/${b.id}/record`).expect(200);
    expect(debits(await entryOf(b.id), '1500')).toBe(11_80_000_00);
    const v = (await get('/inventory/valuation?asOf=2026-06-30').expect(200))
      .body as { total: number };
    expect(v.total).toBe(11_80_000_00);
  });

  it('reports the credit not taken in GSTR-3B 4(B)(1), apart from the credit taken', async () => {
    const r = (
      await get('/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30').expect(
        200,
      )
    ).body as {
      itc: { cgst: number; sgst: number };
      itcReversed: {
        blocked: { cgst: number; sgst: number };
        ineligible: { cgst: number; sgst: number };
      };
    };
    expect(r.itc).toMatchObject({ cgst: 90_00, sgst: 90_00 });
    // Lunch 500 + car 1,80,000, split CGST/SGST
    expect(r.itcReversed.blocked).toMatchObject({
      cgst: 250_00 + 90_000_00,
      sgst: 250_00 + 90_000_00,
    });
    expect(r.itcReversed.ineligible).toMatchObject({
      cgst: 180_00,
      sgst: 180_00,
    });
  });
});
