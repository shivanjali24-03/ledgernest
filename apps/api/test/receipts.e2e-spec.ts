import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Entry = { lines: { account: { code: string }; debit: number; credit: number; foreignCredit: number; fxSourceLine: number | null }[] };

describe('Receipts against invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let org = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) => auth(http().put(`/api/v1${p}`)).send(body),
    };
  };
  const issue = async (contactId: string, issueDate: string, lines: object[]) => {
    const d = (await as().post('/invoices', { contactId, issueDate, lines }).expect(201)).body;
    return (await as().post(`/invoices/${d.id}/issue`).expect(200)).body as { id: string; total: number };
  };
  const balanceOf = async (id: string) => (await as().get(`/invoices/${id}`).expect(200)).body as { balance: number; amountPaid: number; state: string; payments: { number: string }[] };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (await prisma.organization.create({ data: { name: `Receipts ${run}`, slug: `receipts-${run}`, country: 'IN', region: 'Maharashtra', fiscalYearStartMonth: 4 } })).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await as().put('/currencies/USD/rates/2026-05-01', { rate: '90' }).expect(200);
    await as().put('/currencies/USD/rates/2026-05-20', { rate: '93' }).expect(200);
    for (const [key, body] of [
      ['debtors', { code: '1300', type: 'asset', subtype: 'accounts_receivable' }],
      ['usdDebtors', { code: '1250', type: 'asset', subtype: 'accounts_receivable', currency: 'USD' }],
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['usdBank', { code: '1150', type: 'asset', subtype: 'bank', currency: 'USD' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (await as().post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    const gst18 = ((await as().post('/taxes/gst-setup').expect(200)).body.groups as { id: string; name: string }[]).find((g) => g.name === 'GST 18%')!.id;
    contact.kumar = (await as().post('/contacts', { name: 'Kumar Logistics', isCustomer: true, isVendor: false, taxId: `27AAKCK4821R1Z${gstinCheckChar('27AAKCK4821R1Z')}`, billingAddress: { country: 'IN' } }).expect(201)).body.id;
    contact.northwind = (await as().post('/contacts', { name: 'Northwind Inc.', isCustomer: true, isVendor: false, currency: 'USD' }).expect(201)).body.id;
    contact.sharma = (await as().post('/contacts', { name: 'Sharma Supplies', isCustomer: false, isVendor: true }).expect(201)).body.id;
    inv.a = (await issue(contact.kumar, '2026-05-05', [{ description: 'Development', quantity: 3, unitPrice: 250_000, taxGroupId: gst18, accountId: acc.sales }])).id;
    inv.b = (await issue(contact.kumar, '2026-05-06', [{ description: 'Support', quantity: 1, unitPrice: 100_000, taxGroupId: gst18, accountId: acc.sales }])).id;
    inv.n = (await issue(contact.northwind, '2026-05-10', [{ description: 'Retainer', quantity: 10, unitPrice: 5_000, accountId: acc.sales }])).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  let receipt = '';

  it("lists what the customer has left to pay, oldest due first", async () => {
    const open = (await as('auditor').get(`/payments/open-invoices/${contact.kumar}`).expect(200)).body as { id: string; balance: number }[];
    expect(open.map((i) => [i.id, i.balance])).toEqual([
      [inv.a, 885_000],
      [inv.b, 118_000],
    ]);
  });

  it('refuses vendors, over-allocation and a bank in another currency', async () => {
    const base = { date: '2026-05-15', bankAccountId: acc.bank, amount: 1_000 };
    expect((await as().post('/payments/receipts', { ...base, contactId: contact.sharma }).expect(400)).body.details.reason).toBe('not_customer');
    expect((await as().post('/payments/receipts', { ...base, contactId: contact.kumar, amount: 900_000, allocations: [{ invoiceId: inv.a, amount: 885_001 }] }).expect(409)).body.details.reason).toBe('over_allocated');
    expect((await as().post('/payments/receipts', { ...base, contactId: contact.kumar, bankAccountId: acc.usdBank }).expect(400)).body.details.reason).toBe('bank_currency');
    expect((await as().post('/payments/receipts', { ...base, contactId: contact.kumar, allocations: [{ invoiceId: inv.n, amount: 100 }] }).expect(400)).body.details.reason).toBe('invoice_not_found');
    await as('auditor').post('/payments/receipts', { ...base, contactId: contact.kumar }).expect(403);
  });

  it('records a receipt across two invoices, keeping the rest as an advance', async () => {
    const r = (await as().post('/payments/receipts', { contactId: contact.kumar, date: '2026-05-15', bankAccountId: acc.bank, amount: 1_000_000, reference: 'UTR 402918', allocations: [{ invoiceId: inv.a, amount: 885_000 }, { invoiceId: inv.b, amount: 100_000 }] }).expect(201)).body;
    receipt = r.id;
    expect(r).toMatchObject({ number: 'RCT/2026-27/0001', allocated: 985_000, unallocated: 15_000, status: 'posted' });
    const e = (await as().get(`/journals/${r.journalEntry.id}`).expect(200)).body as Entry;
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['1100', 1_000_000, 0],
      ['1300', 0, 1_000_000],
    ]);
    expect(await balanceOf(inv.a)).toMatchObject({ balance: 0, state: 'paid', payments: [{ number: 'RCT/2026-27/0001' }] });
    expect(await balanceOf(inv.b)).toMatchObject({ balance: 18_000, amountPaid: 100_000 });
    // ₹18,000 still owed, less ₹15,000 on account
    expect((await as().get(`/contacts/${contact.kumar}`).expect(200)).body.receivable).toBe(3_000);
    expect((await as().get('/invoices?state=paid').expect(200)).body.total).toBe(1);
  });

  it('settles a USD invoice into a rupee account, realising the exchange gain', async () => {
    // Invoiced at 90, paid on 20 May at 93: USD 500 brings ₹46,500 for a receivable carried at ₹45,000
    const r = (await as().post('/payments/receipts', { contactId: contact.northwind, date: '2026-05-20', bankAccountId: acc.bank, amount: 50_000, allocations: [{ invoiceId: inv.n, amount: 50_000 }] }).expect(201)).body;
    expect(r).toMatchObject({ currency: 'USD', rate: '93' });
    const e = (await as().get(`/journals/${r.journalEntry.id}`).expect(200)).body as Entry;
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit, l.foreignCredit])).toEqual([
      ['1100', 4_650_000, 0, 0],
      ['1250', 0, 4_650_000, 50_000],
      ['1250', 150_000, 0, 0],
      ['4950', 0, 150_000, 0],
    ]);
    expect((await balanceOf(inv.n)).state).toBe('paid');
  });

  it("a paid invoice can't be voided; voiding the receipt opens it again", async () => {
    expect((await as().post(`/invoices/${inv.a}/void`, {}).expect(409)).body.details.reason).toBe('has_payments');
    const p = (await as().get(`/payments/${receipt}`).expect(200)).body;
    expect((await as().post(`/journals/${p.journalEntry.id}/reverse`, {}).expect(409)).body.details.reason).toBe('document_entry');
    const v = (await as().post(`/payments/${receipt}/void`, { reason: 'Bounced cheque' }).expect(200)).body;
    expect(v.status).toBe('void');
    expect(await balanceOf(inv.a)).toMatchObject({ balance: 885_000, payments: [] });
    expect((await balanceOf(inv.b)).balance).toBe(118_000);
    await as().post(`/payments/${receipt}/void`, {}).expect(409);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: org, action: { startsWith: 'org.payment.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.payment.receive', 'org.payment.void']));
  });
});
