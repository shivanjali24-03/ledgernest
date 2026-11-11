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
type Result = {
  saved: boolean;
  valid: number;
  summary: { count: number; total: number };
  results: { row: number; ok: boolean; errors: { field: string }[] }[];
};

/** What customers and vendors owed when the books started here, brought in invoice by invoice */
describe('Opening invoices and bills (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const balance = async (accountId: string) => {
    const s = await prisma.journalLine.aggregate({
      where: { accountId, entry: { status: 'posted' } },
      _sum: { debit: true, credit: true },
    });
    return Number((s._sum.debit ?? 0n) - (s._sum.credit ?? 0n));
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
          name: `Opening docs ${run}`,
          slug: `opening-docs-${run}`,
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
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    for (const body of [
      {
        name: 'Joshi Traders',
        isCustomer: true,
        isVendor: false,
        taxId: gstin('27ABZPJ6519M1Z'),
        paymentTermsDays: 30,
      },
      { name: 'Kale Enterprises', isCustomer: true, isVendor: false },
      { name: 'Shah Packaging', isCustomer: false, isVendor: true },
    ])
      await post('/contacts', body).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('checks every row first: customer, number, dates and amount', async () => {
    const r = (
      await post('/imports/opening_invoices/preview', {
        date: '2026-04-01',
        rows: [
          {
            party: 'Joshi Traders',
            number: 'JT/25-26/118',
            date: '15/02/2026',
            amount: '1,18,000.00',
          },
          {
            party: 'Nobody & Co',
            number: 'X-1',
            date: '2026-03-01',
            amount: '100',
          },
          {
            party: 'Kale Enterprises',
            number: 'K-9',
            date: '2026-05-01',
            amount: '100',
          },
          {
            party: 'Kale Enterprises',
            number: 'K-10',
            date: '2026-03-01',
            amount: 'abc',
          },
          {
            party: 'joshi traders',
            number: 'JT/25-26/118',
            date: '2026-03-01',
            amount: '5',
          },
        ],
      }).expect(200)
    ).body as Result;
    expect(r.results.map((x) => [x.ok, x.errors.map((e) => e.field)])).toEqual([
      [true, []],
      [false, ['party']],
      [false, ['date']],
      [false, ['amount']],
      [false, ['number']],
    ]);
    expect(r.saved).toBe(false);
  });

  it('brings outstanding invoices in as owed, dated as they were, with nothing of them a sale', async () => {
    const r = (
      await post('/imports/opening_invoices', {
        date: '2026-04-01',
        rows: [
          {
            party: 'Joshi Traders',
            number: 'JT/25-26/118',
            date: '15/02/2026',
            amount: '1,18,000.00',
          },
          {
            party: 'Kale Enterprises',
            number: 'K-42',
            date: '2026-03-20',
            dueDate: '2026-04-10',
            amount: '25000',
          },
        ],
      }).expect(200)
    ).body as Result;
    expect(r).toMatchObject({
      saved: true,
      summary: { count: 2, total: 1_43_000_00 },
    });
    expect(await balance(acc.debtors)).toBe(1_43_000_00);
    const list = (await get('/invoices?pageSize=10').expect(200)).body as {
      items: {
        id: string;
        number: string;
        issueDate: string;
        dueDate: string;
        total: number;
        opening: boolean;
        state: string;
      }[];
    };
    const jt = list.items.find((i) => i.number === 'JT/25-26/118')!;
    // Due 30 days after it was issued, so it's overdue already
    expect(jt).toMatchObject({
      issueDate: '2026-02-15',
      dueDate: '2026-03-17',
      total: 1_18_000_00,
    });
    expect(
      (
        (await get(`/invoices/${jt.id}`).expect(200)).body as {
          opening: boolean;
        }
      ).opening,
    ).toBe(true);
    // Paid like any invoice
    await post('/payments/receipts', {
      contactId: (
        await prisma.contact.findFirstOrThrow({
          where: { organizationId: org, name: 'Joshi Traders' },
        })
      ).id,
      date: '2026-04-05',
      bankAccountId: acc.bank,
      amount: 18_000_00,
      allocations: [{ invoiceId: jt.id, amount: 18_000_00 }],
    }).expect(201);
    expect(
      (
        (await get(`/invoices/${jt.id}`).expect(200)).body as {
          balance: number;
        }
      ).balance,
    ).toBe(1_00_000_00);
    // Not a sale: no income, nothing in GSTR-1 or the sales report, no e-invoice
    const g1 = (
      await get('/reports/gst/gstr-1?from=2026-02-01&to=2026-04-30').expect(200)
    ).body as { b2b: unknown[] };
    expect(g1.b2b).toEqual([]);
    const pl = (
      await get(
        '/reports/profit-and-loss?from=2026-04-01&to=2026-04-30',
      ).expect(200)
    ).body as { totals?: { income?: number } };
    expect(pl.totals?.income ?? 0).toBe(0);
    expect(
      (await get(`/invoices/${jt.id}/e-invoice`).expect(409)).body.details,
    ).toMatchObject({ reason: 'opening_invoice' });
    // Not twice
    expect(
      (
        (
          await post('/imports/opening_invoices/preview', {
            date: '2026-04-01',
            rows: [
              {
                party: 'Kale Enterprises',
                number: 'K-42',
                date: '2026-03-20',
                amount: '1',
              },
            ],
          }).expect(200)
        ).body as Result
      ).results[0]!.errors.map((e) => e.field),
    ).toEqual(['number']);
  });

  it('brings bills owed to vendors in as OB/… with their own number for reference', async () => {
    const r = (
      await post('/imports/opening_bills', {
        date: '2026-04-01',
        rows: [
          {
            party: 'Shah Packaging',
            number: 'SP-771',
            date: '28-03-2026',
            amount: '9440',
          },
        ],
      }).expect(200)
    ).body as Result;
    expect(r.saved).toBe(true);
    expect(await balance(acc.creditors)).toBe(-9_440_00);
    const bills = (await get('/bills?pageSize=10').expect(200)).body as {
      items: {
        number: string;
        vendorReference: string;
        opening: boolean;
        billDate: string;
      }[];
    };
    expect(bills.items[0]).toMatchObject({
      number: 'OB/2026-27/0001',
      vendorReference: 'SP-771',
      billDate: '2026-03-28',
    });
    // A new bill still starts the series at 0001
    const shah = (
      await prisma.contact.findFirstOrThrow({
        where: { organizationId: org, name: 'Shah Packaging' },
      })
    ).id;
    const b = (
      await post('/bills', {
        contactId: shah,
        billDate: '2026-04-10',
        lines: [
          {
            description: 'Boxes',
            quantity: 1,
            unitPrice: 1_000_00,
            accountId: acc.bank,
          },
        ],
      }).expect(201)
    ).body.id as string;
    expect(
      (
        (await post(`/bills/${b}/record`).expect(200)).body as {
          number: string;
        }
      ).number,
    ).toBe('BILL/2026-27/0001');
  });
});
