import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Entry = {
  lines: {
    account: { code: string; name: string };
    debit: number;
    credit: number;
    currency: string | null;
    foreignCredit: number;
  }[];
};
type Note = {
  id: string;
  number: string;
  total: number;
  taxTotal: number;
  applied: number;
  remaining: number;
  status: string;
  journalEntry: { id: string };
  taxBreakdown: { name: string; amount: number }[];
  applications: {
    kind: string;
    amount: number;
    journalEntry?: { id: string };
  }[];
};

describe('Credit notes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const inv: Record<string, { id: string; lines: { id: string }[] }> = {};
  const cn: Record<string, Note> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
    };
  };
  const issue = async (
    contactId: string,
    issueDate: string,
    lines: object[],
  ) => {
    const d = (
      await as().post('/invoices', { contactId, issueDate, lines }).expect(201)
    ).body;
    return (await as().post(`/invoices/${d.id}/issue`).expect(200)).body as {
      id: string;
      lines: { id: string }[];
    };
  };
  const invoice = async (id: string) =>
    (await as().get(`/invoices/${id}`).expect(200)).body as {
      balance: number;
      amountPaid: number;
      state: string;
      credits: { number: string; amount: number }[];
      creditNotes: { number: string; status: string }[];
    };
  const entry = async (id: string) =>
    (await as().get(`/journals/${id}`).expect(200)).body as Entry;
  const receivable = async (id: string) =>
    (await as().get(`/contacts/${id}`).expect(200)).body.receivable as number;

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
          name: `Credit notes ${run}`,
          slug: `credit-notes-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: `User ${key}`,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = {
        id: u.id,
        token: await jwt.signAsync(
          { sub: u.id, sa: false },
          { expiresIn: '15m' },
        ),
      };
    }
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await as()
      .put('/currencies/USD/rates/2026-05-01', { rate: '90' })
      .expect(200);
    await as()
      .put('/currencies/USD/rates/2026-05-20', { rate: '93' })
      .expect(200);
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'usdDebtors',
        {
          code: '1250',
          type: 'asset',
          subtype: 'accounts_receivable',
          currency: 'USD',
        },
      ],
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    const gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
          taxId: `27AAKCK4821R1Z${gstinCheckChar('27AAKCK4821R1Z')}`,
          billingAddress: { country: 'IN' },
        })
        .expect(201)
    ).body.id;
    contact.northwind = (
      await as()
        .post('/contacts', {
          name: 'Northwind Inc.',
          isCustomer: true,
          isVendor: false,
          currency: 'USD',
        })
        .expect(201)
    ).body.id;
    inv.a = await issue(contact.kumar, '2026-05-05', [
      {
        description: 'Development',
        quantity: 3,
        unitPrice: 250_000,
        taxGroupId: gst18,
        accountId: acc.sales,
      },
    ]);
    inv.n = await issue(contact.northwind, '2026-05-10', [
      {
        description: 'Retainer',
        quantity: 10,
        unitPrice: 5_000,
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

  it('credits part of an invoice: the opposite entry with its GST, off what the invoice has left', async () => {
    expect(
      (await as().get(`/credit-notes/creditable/${inv.a!.id}`).expect(200))
        .body,
    ).toEqual([{ invoiceLineId: inv.a!.lines[0]!.id, quantity: '3' }]);
    const c = (
      await as()
        .post('/credit-notes', {
          invoiceId: inv.a!.id,
          date: '2026-05-12',
          reason: 'One day not delivered',
          lines: [{ invoiceLineId: inv.a!.lines[0]!.id, quantity: '1' }],
        })
        .expect(201)
    ).body as Note;
    cn.one = c;
    // ₹2,500 and its 18% GST: ₹2,950
    expect(c).toMatchObject({
      number: 'CN/2026-27/0001',
      total: 295_000,
      taxTotal: 45_000,
      applied: 295_000,
      remaining: 0,
      status: 'issued',
    });
    expect(c.taxBreakdown).toEqual([
      { name: 'CGST 9%', amount: 22_500 },
      { name: 'SGST 9%', amount: 22_500 },
    ]);
    const e = await entry(c.journalEntry.id);
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['4100', 250_000, 0],
      [expect.any(String), 22_500, 0],
      [expect.any(String), 22_500, 0],
      ['1300', 0, 295_000],
    ]);
    expect(e.lines.slice(1, 3).map((l) => l.account.name)).toEqual([
      expect.stringMatching(/CGST/),
      expect.stringMatching(/SGST/),
    ]);
    expect(await invoice(inv.a!.id)).toMatchObject({
      balance: 590_000,
      credits: [{ number: 'CN/2026-27/0001', amount: 295_000 }],
      creditNotes: [{ number: 'CN/2026-27/0001', status: 'issued' }],
    });
    expect(
      (await as().get(`/credit-notes/creditable/${inv.a!.id}`).expect(200))
        .body[0].quantity,
    ).toBe('2');
  });

  it('refuses crediting more than is left, a line of another invoice, or as an Auditor', async () => {
    const line = inv.a!.lines[0]!.id;
    expect(
      (
        await as()
          .post('/credit-notes', {
            invoiceId: inv.a!.id,
            date: '2026-05-12',
            lines: [{ invoiceLineId: line, quantity: '2.5' }],
          })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'over_credited', left: '2' });
    expect(
      (
        await as()
          .post('/credit-notes', {
            invoiceId: inv.a!.id,
            date: '2026-05-12',
            lines: [{ invoiceLineId: inv.n!.lines[0]!.id, quantity: '1' }],
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('line_not_found');
    expect(
      (
        await as()
          .post('/credit-notes', {
            invoiceId: inv.a!.id,
            date: '2026-05-01',
            lines: [{ invoiceLineId: line, quantity: '1' }],
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('before_invoice');
    await as('auditor')
      .post('/credit-notes', {
        invoiceId: inv.a!.id,
        date: '2026-05-12',
        lines: [{ invoiceLineId: line, quantity: '1' }],
      })
      .expect(403);
    // With credit on it, the invoice can't simply be voided
    expect(
      (await as().post(`/invoices/${inv.a!.id}/void`, {}).expect(409)).body
        .details.reason,
    ).toBe('has_payments');
  });

  it('credit on a paid invoice stays with the customer, for the next invoice or a refund', async () => {
    await as()
      .post('/payments/receipts', {
        contactId: contact.kumar,
        date: '2026-05-15',
        bankAccountId: acc.bank,
        amount: 590_000,
        allocations: [{ invoiceId: inv.a!.id, amount: 590_000 }],
      })
      .expect(201);
    const c = (
      await as()
        .post('/credit-notes', {
          invoiceId: inv.a!.id,
          date: '2026-05-16',
          lines: [{ invoiceLineId: inv.a!.lines[0]!.id, quantity: '1' }],
        })
        .expect(201)
    ).body as Note;
    cn.two = c;
    expect(c).toMatchObject({
      number: 'CN/2026-27/0002',
      applied: 0,
      remaining: 295_000,
    });
    expect(await receivable(contact.kumar)).toBe(-295_000);

    inv.b = await issue(contact.kumar, '2026-05-18', [
      {
        description: 'Support',
        quantity: 1,
        unitPrice: 100_000,
        accountId: acc.sales,
      },
    ]);
    expect(
      (
        await as()
          .post(`/credit-notes/${c.id}/apply`, {
            invoiceId: inv.b.id,
            amount: 100_001,
          })
          .expect(409)
      ).body.details.reason,
    ).toBe('over_allocated');
    const applied = (
      await as()
        .post(`/credit-notes/${c.id}/apply`, {
          invoiceId: inv.b.id,
          amount: 100_000,
          date: '2026-05-18',
        })
        .expect(200)
    ).body as Note;
    expect(applied).toMatchObject({ applied: 100_000, remaining: 195_000 });
    expect(await invoice(inv.b.id)).toMatchObject({
      state: 'paid',
      credits: [{ number: 'CN/2026-27/0002', amount: 100_000 }],
    });

    expect(
      (
        await as()
          .post(`/credit-notes/${c.id}/refund`, {
            date: '2026-05-20',
            bankAccountId: acc.bank,
            amount: 195_001,
          })
          .expect(409)
      ).body.details.reason,
    ).toBe('over_applied');
    const refunded = (
      await as()
        .post(`/credit-notes/${c.id}/refund`, {
          date: '2026-05-20',
          bankAccountId: acc.bank,
          amount: 195_000,
          reference: 'NEFT 7731',
        })
        .expect(200)
    ).body as Note;
    expect(refunded).toMatchObject({ applied: 295_000, remaining: 0 });
    const refund = refunded.applications.find((a) => a.kind === 'refund')!;
    expect(
      (await entry(refund.journalEntry!.id)).lines.map((l) => [
        l.account.code,
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      ['1300', 195_000, 0],
      ['1100', 0, 195_000],
    ]);
    expect(await receivable(contact.kumar)).toBe(0);
  });

  it('voids a credit note that was not refunded, and the invoice is owed again', async () => {
    expect(
      (await as().post(`/credit-notes/${cn.two!.id}/void`, {}).expect(409)).body
        .details.reason,
    ).toBe('has_refunds');
    expect(
      (
        await as()
          .post(`/journals/${cn.one!.journalEntry.id}/reverse`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('document_entry');
    const v = (
      await as()
        .post(`/credit-notes/${cn.one!.id}/void`, {
          reason: 'Delivered after all',
        })
        .expect(200)
    ).body as Note;
    expect(v).toMatchObject({ status: 'void', remaining: 0 });
    expect(await invoice(inv.a!.id)).toMatchObject({
      balance: 295_000,
      credits: [],
      creditNotes: [{ status: 'void' }, { status: 'issued' }],
    });
    await as().post(`/credit-notes/${cn.one!.id}/void`, {}).expect(409);
    // Credit voided frees its quantity again
    expect(
      (await as().get(`/credit-notes/creditable/${inv.a!.id}`).expect(200))
        .body[0].quantity,
    ).toBe('2');
  });

  it('credits a USD invoice at the rate it was posted at, with no exchange difference', async () => {
    const c = (
      await as()
        .post('/credit-notes', {
          invoiceId: inv.n!.id,
          date: '2026-05-25',
          lines: [{ invoiceLineId: inv.n!.lines[0]!.id, quantity: '10' }],
        })
        .expect(201)
    ).body as Note;
    expect(c).toMatchObject({ total: 50_000, applied: 50_000 });
    expect(
      (await entry(c.journalEntry.id)).lines.map((l) => [
        l.account.code,
        l.debit,
        l.credit,
        l.currency,
        l.foreignCredit,
      ]),
    ).toEqual([
      ['4100', 4_500_000, 0, null, 0],
      ['1250', 0, 4_500_000, 'USD', 50_000],
    ]);
    expect((await invoice(inv.n!.id)).state).toBe('paid');
  });

  it('lists credit notes and audits them', async () => {
    const l = (
      await as('auditor')
        .get(`/credit-notes?contactId=${contact.kumar}`)
        .expect(200)
    ).body as { total: number; items: Note[] };
    expect(l.items.map((n) => n.number)).toEqual([
      'CN/2026-27/0002',
      'CN/2026-27/0001',
    ]);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: org,
          action: { startsWith: 'org.credit_note.' },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.credit_note.issue',
        'org.credit_note.apply',
        'org.credit_note.refund',
        'org.credit_note.void',
      ]),
    );
  });
});
