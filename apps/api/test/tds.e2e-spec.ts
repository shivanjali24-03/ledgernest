import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar, tdsDepositDue, todayIn } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
const MEHTA = gstin('27AAKFM2468P1Z');

type Payment = {
  id: string;
  number: string;
  amount: number;
  bankAmount: number;
  journalEntry: { id: string };
  tds: {
    section: string;
    ratePpm: number;
    base: number;
    amount: number;
    account: { code: string };
  } | null;
};

describe('TDS on vendor payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';
  let gst18 = '';
  // Dated today, so the due date list sees it whenever this runs
  const today = todayIn('Asia/Kolkata');
  const fy =
    Number(today.slice(5, 7)) >= 4
      ? Number(today.slice(0, 4))
      : Number(today.slice(0, 4)) - 1;

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
    };
  };
  const bill = async (contactId: string, unitPrice: number) => {
    const b = (
      await as()
        .post('/bills', {
          contactId,
          vendorReference: `MA/${randomUUID().slice(0, 4)}`,
          billDate: today,
          lines: [
            {
              description: 'Statutory audit',
              quantity: 1,
              unitPrice,
              taxGroupId: gst18,
              accountId: acc.fees,
            },
          ],
        })
        .expect(201)
    ).body as { id: string; total: number };
    await as().post(`/bills/${b.id}/record`).expect(200);
    return b;
  };
  const balance = async (accountId: string) => {
    const tb = (
      await as().get(`/reports/trial-balance?asOf=${today}`).expect(200)
    ).body as {
      rows: {
        accountId: string;
        balanceDebit: number;
        balanceCredit: number;
      }[];
    };
    const r = tb.rows.find((x) => x.accountId === accountId);
    return r ? r.balanceDebit - r.balanceCredit : 0;
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
          name: `TDS ${run}`,
          slug: `tds-${run}`,
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
    users.owner = await jwt.signAsync(
      { sub: u.id, sa: false },
      { expiresIn: '15m' },
    );
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['tds', { code: '2200', type: 'liability', subtype: 'tax_payable' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['tdsr', { code: '1400', type: 'asset', subtype: 'current_asset' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['fees', { code: '5500', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: fy }).expect(201);
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    for (const [key, body] of [
      [
        'mehta',
        {
          name: 'Mehta & Associates',
          legalName: 'Mehta and Associates LLP',
          isVendor: true,
          isCustomer: false,
          taxId: MEHTA,
        },
      ],
      [
        'kumar',
        {
          name: 'Kumar Logistics',
          isVendor: false,
          isCustomer: true,
          taxId: gstin('27AAKCK4821R1Z'),
        },
      ],
      [
        'joshi',
        { name: 'R. Joshi (contractor)', isVendor: true, isCustomer: false },
      ],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let paid: Payment;

  it('settles the bill in full, pays the bank less, and owes the TDS to the government', async () => {
    // Audit fees: ₹50,000 + 18% GST = ₹59,000; TDS under 194J at 10% of ₹50,000
    const b = await bill(contact.mehta, 50_000_00);
    paid = (
      await as()
        .post('/payments/payments', {
          contactId: contact.mehta,
          date: today,
          bankAccountId: acc.bank,
          amount: 59_000_00,
          allocations: [{ billId: b.id, amount: 59_000_00 }],
          tds: {
            section: '194J',
            ratePpm: 100_000,
            base: 50_000_00,
            amount: 5_000_00,
            accountId: acc.tds,
          },
        })
        .expect(201)
    ).body as Payment;
    expect(paid).toMatchObject({
      amount: 59_000_00,
      bankAmount: 54_000_00,
      tds: {
        section: '194J',
        ratePpm: 100_000,
        base: 50_000_00,
        amount: 5_000_00,
        account: { code: '2200' },
      },
    });
    expect((await as().get(`/bills/${b.id}`).expect(200)).body.balance).toBe(0);
    // Bank down ₹54,000, TDS payable ₹5,000, nothing left owed to Mehta
    expect(await balance(acc.bank)).toBe(-54_000_00);
    expect(await balance(acc.tds)).toBe(-5_000_00);
    expect(await balance(acc.creditors)).toBe(0);
  });

  it('refuses TDS on the wrong kind of account, or as much as the payment', async () => {
    const b = await bill(contact.joshi, 10_000_00);
    const pay = (tds: object) =>
      as().post('/payments/payments', {
        contactId: contact.joshi,
        date: today,
        bankAccountId: acc.bank,
        amount: 11_800_00,
        allocations: [{ billId: b.id, amount: 11_800_00 }],
        tds,
      });
    expect(
      (
        await pay({
          section: '194C',
          ratePpm: 10_000,
          base: 10_000_00,
          amount: 100_00,
          accountId: acc.fees,
        }).expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'tds_account' });
    await pay({
      section: '194C',
      ratePpm: 10_000,
      base: 10_000_00,
      amount: 11_800_00,
      accountId: acc.tds,
    }).expect(400);
    // Joshi has no GSTIN, so no PAN on file
    await pay({
      section: '194C',
      ratePpm: 10_000,
      base: 10_000_00,
      amount: 100_00,
      accountId: acc.tds,
    }).expect(201);
  });

  it('reports TDS by section and month with the vendor PAN, and lists the deposit as due', async () => {
    const r = (
      await as()
        .get(`/reports/tds?from=${today.slice(0, 8)}01&to=${today}`)
        .expect(200)
    ).body as {
      total: number;
      sections: { section: string; count: number; base: number; tds: number }[];
      months: { month: string; due: string; tds: number }[];
      missingPan: string[];
      payments: {
        vendor: { pan: string | null };
        section: string;
        tds: number;
      }[];
    };
    expect(r.total).toBe(5_100_00);
    expect(r.sections).toEqual([
      { section: '194C', count: 1, base: 10_000_00, tds: 100_00 },
      { section: '194J', count: 1, base: 50_000_00, tds: 5_000_00 },
    ]);
    expect(r.months).toEqual([
      expect.objectContaining({
        month: today.slice(0, 7),
        due: tdsDepositDue(today.slice(0, 7)),
        tds: 5_100_00,
      }),
    ]);
    expect(r.payments.find((p) => p.section === '194J')!.vendor.pan).toBe(
      MEHTA.slice(2, 12),
    );
    expect(r.missingPan).toEqual(['R. Joshi (contractor)']);
    await as().get(`/reports/tds?from=${today}&to=2000-01-01`).expect(400);

    const due = tdsDepositDue(today.slice(0, 7));
    const daysLeft = Math.round(
      (Date.parse(due) - Date.parse(today)) / 86_400_000,
    );
    const items = (
      (await as().get('/reports/compliance').expect(200)).body as {
        items: { kind: string; due: string; amount?: number }[];
      }
    ).items.filter((i) => i.kind === 'tds');
    expect(items).toEqual(
      daysLeft <= 45
        ? [expect.objectContaining({ due, amount: 5_100_00 })]
        : [],
    );
  });

  it('voiding the payment takes the TDS back off, and the bill is owed again', async () => {
    await as()
      .post(`/payments/${paid.id}/void`, { reason: 'Wrong section' })
      .expect(200);
    expect(await balance(acc.tds)).toBe(-100_00);
    const r = (
      await as()
        .get(`/reports/tds?from=${today.slice(0, 8)}01&to=${today}`)
        .expect(200)
    ).body as { sections: { section: string }[] };
    expect(r.sections.map((s) => s.section)).toEqual(['194C']);
  });

  it('takes TDS a customer kept back as receivable: the invoice is paid in full, the bank gets the rest', async () => {
    const inv = (
      await as()
        .post('/invoices', {
          contactId: contact.kumar,
          issueDate: today,
          lines: [
            {
              description: 'Consulting',
              quantity: 1,
              unitPrice: 1_00_000_00,
              taxGroupId: gst18,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/invoices/${inv.id}/issue`).expect(200);
    const receive = (accountId: string) =>
      as().post('/payments/receipts', {
        contactId: contact.kumar,
        date: today,
        bankAccountId: acc.bank,
        amount: 1_18_000_00,
        allocations: [{ invoiceId: inv.id, amount: 1_18_000_00 }],
        tds: {
          section: '194J',
          ratePpm: 100_000,
          base: 1_00_000_00,
          amount: 10_000_00,
          accountId,
        },
      });
    // Not on a liability: that's TDS we owe, not TDS to claim back
    expect((await receive(acc.tds).expect(400)).body.details).toMatchObject({
      reason: 'tds_account',
    });
    const bankBefore = await balance(acc.bank);
    const r = (await receive(acc.tdsr).expect(201)).body as Payment;
    expect(r).toMatchObject({
      amount: 1_18_000_00,
      bankAmount: 1_08_000_00,
      tds: { section: '194J', amount: 10_000_00 },
    });
    expect(
      (await as().get(`/invoices/${inv.id}`).expect(200)).body.balance,
    ).toBe(0);
    expect((await balance(acc.bank)) - bankBefore).toBe(1_08_000_00);
    expect(await balance(acc.tdsr)).toBe(10_000_00);
    // The receipt PDF says what the customer kept back and what reached the bank
    const pdf = (
      await as()
        .get(`/payments/${r.id}/pdf`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200)
    ).body as Buffer;
    expect(pdf.toString('latin1')).toContain(
      '(Of which TDS deducted by you \\(194J\\)) Tj',
    );
    expect(pdf.toString('latin1')).toContain('(108000.00) Tj');
    expect(await balance(acc.debtors)).toBe(0);
    const report = (
      await as()
        .get(
          `/reports/tds?from=${today.slice(0, 8)}01&to=${today}&side=receivable`,
        )
        .expect(200)
    ).body as {
      side: string;
      total: number;
      payments: { vendor: { name: string; pan: string | null } }[];
    };
    expect(report).toMatchObject({ side: 'receivable', total: 10_000_00 });
    expect(report.payments).toEqual([
      expect.objectContaining({
        vendor: expect.objectContaining({ pan: 'AAKCK4821R' }),
      }),
    ]);
  });

  it('flags vendors charging GST without a GSTIN on file in the GST health check', async () => {
    const r = (await as().get('/reports/gst/health').expect(200)).body as {
      issues: { kind: string; sample: { name: string }[] }[];
    };
    expect(
      r.issues
        .find((i) => i.kind === 'vendors_gstin')!
        .sample.map((x) => x.name),
    ).toEqual(['R. Joshi (contractor)']);
  });
});
