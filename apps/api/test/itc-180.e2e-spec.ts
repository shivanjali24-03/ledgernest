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

describe('180-day rule for input tax credit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let vendor = '';
  let bank = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const bill = async (vendorBillDate: string, unitPrice: number) => {
    const b = (
      await post('/bills', {
        contactId: vendor,
        billDate: vendorBillDate,
        vendorBillDate,
        vendorReference: `V-${randomUUID().slice(0, 6)}`,
        lines: [
          {
            description: 'Raw material',
            quantity: 1,
            unitPrice,
            taxGroupId: gst18,
            accountId: expense,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`/bills/${b.id}/record`).expect(200);
    return b.id;
  };
  const pay = (billId: string, date: string, amount: number) =>
    post('/payments/payments', {
      contactId: vendor,
      date,
      bankAccountId: bank,
      amount,
      allocations: [{ billId, amount }],
    }).expect(201);
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
          name: `ITC180 ${run}`,
          slug: `itc180-${run}`,
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
    await post('/fiscal-years', { startYear: 2027 }).expect(201);
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst18 = groups.find((g) => g.name === 'GST 18%')!.id;
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
    bank = await account('1100', 'asset', 'bank');
    vendor = (
      await post('/contacts', {
        name: 'Deccan Metals',
        isCustomer: false,
        isVendor: true,
        taxId: gstin('27AABFD1234K1Z'),
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

  type Report = {
    bills: {
      id: string;
      state: string;
      deadline: string;
      reversed: { cgst: number };
      reclaimable: { cgst: number };
      atRisk: { cgst: number };
    }[];
    totals: { dueSoon: number; reverse: number; reclaim: number };
  };
  let half = '';
  let unpaid = '';
  it('flags bills in their last 30 days, then the credit to reverse on what’s still unpaid', async () => {
    // ₹1,00,000 + 18% on 1 April: deadline 28 September
    half = await bill('2026-04-01', 1_00_000_00);
    await pay(half, '2026-06-01', 59_000_00);
    unpaid = await bill('2026-04-15', 10_000_00);
    const soon = (await get('/reports/itc-180?date=2026-09-10').expect(200))
      .body as Report;
    expect(soon.bills.find((b) => b.id === half)).toMatchObject({
      state: 'due_soon',
      deadline: '2026-09-28',
      atRisk: { cgst: 4_500_00 },
    });
    const late = (await get('/reports/itc-180?date=2026-10-20').expect(200))
      .body as Report;
    expect(late.bills.find((b) => b.id === half)).toMatchObject({
      state: 'reverse',
      reversed: { cgst: 4_500_00 },
    });
    // 4,500 + 4,500 on the first; 900 + 900 on the second
    expect(late.totals.reverse).toBe(10_800_00);
  });

  it('reverses in GSTR-3B 4(B)(2) for the month the 180 days end, and takes it back in the month it’s paid', async () => {
    const sep = (
      await get('/reports/gst/gstr-3b?from=2026-09-01&to=2026-09-30').expect(
        200,
      )
    ).body as {
      itcReversed: { unpaid180: { cgst: number } };
      itcReclaimed: { cgst: number };
    };
    expect(sep.itcReversed.unpaid180.cgst).toBe(4_500_00);
    await pay(half, '2026-11-05', 59_000_00);
    const nov = (
      await get('/reports/gst/gstr-3b?from=2026-11-01&to=2026-11-30').expect(
        200,
      )
    ).body as typeof sep;
    expect(nov.itcReclaimed.cgst).toBe(4_500_00);
    const r = (await get('/reports/itc-180?date=2026-11-10').expect(200))
      .body as Report;
    expect(r.bills.find((b) => b.id === half)).toMatchObject({
      state: 'reclaim',
      reclaimable: { cgst: 4_500_00 },
    });
    expect(r.bills.find((b) => b.id === unpaid)?.state).toBe('reverse');
  });

  it('raises a dashboard alert for credit at risk', async () => {
    const d = (await get('/reports/dashboard').expect(200)).body as {
      alerts: { kind: string; count: number }[];
    };
    // Today is past both deadlines: the unpaid one still needs reversing
    expect(d.alerts.find((a) => a.kind === 'itc_180')?.count).toBeGreaterThan(
      0,
    );
  });
});
