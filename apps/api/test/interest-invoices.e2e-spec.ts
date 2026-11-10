import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { InterestChargesService } from '../src/invoices/interest-charges.service.js';

type Status = {
  accrued: number;
  charged: number;
  waived: number;
  chargeable: number;
  charges: { id: string; status: string; interest: number }[];
  waivers: { amount: number; reason: string }[];
};
type Draft = {
  id: string;
  status: string;
  subtotal: number;
  reference: string;
  lines: {
    amount: number;
    taxGroup: { name: string } | null;
    account: { code: string };
  }[];
  interest: unknown;
};

describe('Interest invoices and waivers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const gst: Record<string, string> = {};
  let token = '';
  let org = '';
  let kumar = '';
  let source = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const patch = (p: string, body: object) =>
    auth(http().patch(`/api/v1${p}`)).send(body);
  const status = async (id: string) =>
    (await get(`/invoices/${id}/interest`).expect(200)).body as Status;

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
          name: `Interest invoices ${run}`,
          slug: `interest-inv-${run}`,
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
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst.g18 = groups.find((g) => g.name === 'GST 18%')!.id;
    gst.g5 = groups.find((g) => g.name === 'GST 5%')!.id;
    kumar = (
      await post('/contacts', {
        name: 'Kumar Traders',
        isCustomer: true,
        isVendor: false,
        billingAddress: { country: 'IN', region: 'Maharashtra' },
      }).expect(201)
    ).body.id;
    await patch('/organization', {
      interestRateBp: 1800,
      interestMethod: 'simple',
      interestGraceDays: 0,
    }).expect(200);
    // ₹60,000 at 18% GST and ₹40,000 at 5%: ₹1,12,800 due 1 June
    const d = (
      await post('/invoices', {
        contactId: kumar,
        issueDate: '2026-05-01',
        dueDate: '2026-06-01',
        lines: [
          {
            description: 'Steel',
            quantity: 1,
            unitPrice: 60_000_00,
            taxGroupId: gst.g18,
            accountId: acc.sales,
          },
          {
            description: 'Rice',
            quantity: 1,
            unitPrice: 40_000_00,
            taxGroupId: gst.g5,
            accountId: acc.sales,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    source = (
      (await post(`/invoices/${d.id}/issue`).expect(200)).body as { id: string }
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('raises interest as a draft invoice with GST at the supply’s own rates, to Interest on late payment', async () => {
    const accrued = Math.round((1_12_800_00 * 0.18 * 30) / 365);
    const draft = (
      await post(`/invoices/${source}/interest/raise`, {
        asOf: '2026-07-01',
      }).expect(201)
    ).body as Draft;
    expect(draft).toMatchObject({ status: 'draft', subtotal: accrued });
    expect(draft.reference).toMatch(/^INV\//);
    expect(draft.lines.map((l) => [l.taxGroup?.name, l.account.code])).toEqual([
      ['GST 18%', '4970'],
      ['GST 5%', '4970'],
    ]);
    // Split 60:40 by taxable value
    expect(draft.lines.map((l) => l.amount)).toEqual([
      Math.round(accrued * 0.6),
      accrued - Math.round(accrued * 0.6),
    ]);
    // Charged now: nothing left to raise to the same day
    expect(
      (
        await post(`/invoices/${source}/interest/raise`, {
          asOf: '2026-07-01',
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'nothing_to_charge' });
    // Issued, it carries no interest of its own
    const issued = (await post(`/invoices/${draft.id}/issue`).expect(200))
      .body as Draft;
    expect(issued.interest).toBeNull();
  });

  it('waives interest with a reason, and only what’s left to charge', async () => {
    await post(`/invoices/${source}/interest/waive`, { reason: 'x' }).expect(
      400,
    );
    const s = await status(source);
    expect(s.charged).toBe(s.charges.reduce((t, c) => t + c.interest, 0));
    await post(`/invoices/${source}/interest/waive`, {
      amount: s.chargeable + 1,
      reason: 'Too much',
    }).expect(400);
    const after = (
      await post(`/invoices/${source}/interest/waive`, {
        amount: 500_00,
        reason: 'Long-standing customer',
      }).expect(200)
    ).body as Status;
    expect(after).toMatchObject({
      waived: 500_00,
      chargeable: s.chargeable - 500_00,
    });
    expect(after.waivers).toEqual([
      expect.objectContaining({
        amount: 500_00,
        reason: 'Long-standing customer',
      }),
    ]);
  });

  it('raises drafts for everything due at once, and once a month when asked', async () => {
    const all = (
      await post('/invoices/interest/raise', { asOf: '2026-08-31' }).expect(200)
    ).body as { raised: { invoiceId: string; amount: number }[] };
    expect(all.raised.map((r) => r.invoiceId)).toEqual([source]);
    // Monthly: on the 1st, to the end of the month just gone, once
    await patch('/organization', { interestAutoRaise: true }).expect(200);
    const svc = app.get(InterestChargesService);
    expect(
      await svc.runMonthly(new Date('2026-10-01T06:00:00Z')),
    ).toBeGreaterThanOrEqual(1);
    expect(await svc.runMonthly(new Date('2026-10-15T06:00:00Z'))).toBe(0);
    const s = await status(source);
    expect(s.charges.filter((c) => c.status === 'draft')).toHaveLength(2);
  });
});
