import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Invoice = { id: string; number: string | null; status: string; state: string; subtotal: number; taxTotal: number; total: number; dueDate: string; currency: string | null; rate: string | null; journalEntry: { id: string; number: string } | null; taxBreakdown: { name: string; amount: number }[]; lines: { taxGroup: { name: string } | null; amount: number; taxAmount: number }[] };

describe('Sales invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let orgA = '';
  let orgB = '';
  let gst18 = '';
  let dev = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner', org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users.owner!.token}`).set('X-Organization-Id', orgA);
  const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
  const draft = async (body: object) => (await as().post('/invoices', body).expect(201)).body as Invoice;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `Invoices A ${run}`, slug: `invoices-a-${run}`, country: 'IN', region: 'Maharashtra', fiscalYearStartMonth: 4 } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Invoices B ${run}`, slug: `invoices-b-${run}` } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['auditor', orgA, 'auditor'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    await as().post('/currencies', { code: 'USD' }).expect(201);
    await auth(http().put('/api/v1/currencies/USD/rates/2026-05-01')).send({ rate: '90' }).expect(200);
    for (const [key, code, type, subtype] of [
      ['debtors', '1300', 'asset', 'accounts_receivable'],
      ['sales', '4100', 'income', 'operating_income'],
      ['rent', '5300', 'expense', 'operating_expense'],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: orgA, code, name: `${key} ${run}`, type, subtype } })).id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    const setup = (await as().post('/taxes/gst-setup').expect(200)).body as { groups: { id: string; name: string }[] };
    gst18 = setup.groups.find((g) => g.name === 'GST 18%')!.id;
    dev = (await as().post('/items', { name: 'Development', unit: 'hrs', salePrice: 250_000, taxGroupId: gst18, incomeAccountId: acc.sales }).expect(201)).body.id;
    for (const [key, body] of [
      ['kumar', { name: 'Kumar Logistics', isCustomer: true, isVendor: false, taxId: gstin('27AAKCK4821R1Z'), billingAddress: { country: 'IN' }, paymentTermsDays: 15 }],
      ['bluewave', { name: 'Bluewave Clinics', isCustomer: true, isVendor: false, taxId: gstin('29AAQFB7310K1Z'), billingAddress: { country: 'IN' } }],
      ['northwind', { name: 'Northwind Inc.', isCustomer: true, isVendor: false, currency: 'USD', billingAddress: { country: 'US' } }],
      ['sharma', { name: 'Sharma Supplies', isCustomer: false, isVendor: true }],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  let kumarInvoice = '';

  it('drafts an invoice within the state: CGST + SGST, due on the customer’s terms', async () => {
    const i = await draft({ contactId: contact.kumar, issueDate: '2026-05-05', reference: 'PO-4471', lines: [{ itemId: dev, description: 'Sprint 14 development', quantity: 3, unitPrice: 250_000, taxGroupId: gst18 }] });
    kumarInvoice = i.id;
    expect(i).toMatchObject({ status: 'draft', state: 'draft', number: null, subtotal: 750_000, taxTotal: 135_000, total: 885_000, dueDate: '2026-05-20', currency: null });
    expect(i.taxBreakdown).toEqual([
      { name: 'CGST 9%', amount: 67_500 },
      { name: 'SGST 9%', amount: 67_500 },
    ]);
  });

  it('switches to IGST for a customer in another state', async () => {
    const i = await draft({ contactId: contact.bluewave, issueDate: '2026-05-06', lines: [{ itemId: dev, description: 'Consulting', quantity: '2.5', unitPrice: 250_000, discount: 10, taxGroupId: gst18 }] });
    expect(i.lines[0]!.taxGroup!.name).toBe('IGST 18%');
    expect(i.lines[0]).toMatchObject({ amount: 562_500, taxAmount: 101_250 });
    expect(i.taxBreakdown).toEqual([{ name: 'IGST 18%', amount: 101_250 }]);
  });

  it('refuses vendors, lines without an income account, and the wrong kind of account', async () => {
    const reason = async (body: object) => (await as().post('/invoices', { issueDate: '2026-05-06', contactId: contact.kumar, ...body }).expect(400)).body.details.reason;
    expect(await reason({ contactId: contact.sharma, lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.sales }] })).toBe('not_customer');
    expect(await reason({ lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).toBe('account_required');
    expect(await reason({ lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.rent }] })).toBe('not_income');
  });

  it('issues with the next number and posts the receivable against income and output tax', async () => {
    const i = (await as().post(`/invoices/${kumarInvoice}/issue`).expect(200)).body as Invoice;
    // Due on 20 May, which has passed
    expect(i).toMatchObject({ number: 'INV/2026-27/0001', status: 'issued', state: 'overdue' });
    const e = (await as().get(`/journals/${i.journalEntry!.id}`).expect(200)).body as { memo: string; reference: string; lines: { account: { code: string }; debit: number; credit: number }[] };
    expect(e.memo).toBe('Invoice INV/2026-27/0001 · Kumar Logistics');
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['1300', 885_000, 0],
      ['4100', 0, 750_000],
      ['2110', 0, 67_500],
      ['2120', 0, 67_500],
    ]);
    // Issued invoices are final
    await as().patch(`/invoices/${kumarInvoice}`, { contactId: contact.kumar, issueDate: '2026-05-05', lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.sales }] }).expect(409);
    await as().delete(`/invoices/${kumarInvoice}`).expect(409);
    // Its entry can only be undone by voiding the invoice
    expect((await as().post(`/journals/${i.journalEntry!.id}/reverse`, {}).expect(409)).body.details.reason).toBe('document_entry');
  });

  it('bills a foreign customer in their currency, to the receivable kept in it', async () => {
    const i = await draft({ contactId: contact.northwind, issueDate: '2026-05-10', lines: [{ description: 'Support retainer', quantity: 10, unitPrice: 5_000, accountId: acc.sales }] });
    expect(i).toMatchObject({ currency: 'USD', total: 50_000 });
    // No USD receivable yet
    expect((await as().post(`/invoices/${i.id}/issue`).expect(409)).body.details.reason).toBe('no_receivable_account');
    await as().post('/accounts', { code: '1250', name: `USD debtors ${run}`, type: 'asset', subtype: 'accounts_receivable', currency: 'USD' }).expect(201);
    const issued = (await as().post(`/invoices/${i.id}/issue`).expect(200)).body as Invoice;
    expect(issued).toMatchObject({ number: 'INV/2026-27/0002', rate: '90' });
    const e = (await as().get(`/journals/${issued.journalEntry!.id}`).expect(200)).body as { lines: { account: { code: string }; debit: number; credit: number; currency: string | null; foreignDebit: number }[] };
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit, l.currency, l.foreignDebit])).toEqual([
      ['1250', 4_500_000, 0, 'USD', 50_000],
      ['4100', 0, 4_500_000, null, 0],
    ]);
  });

  it('voids an unpaid invoice by reversing its entry', async () => {
    const v = (await as().post(`/invoices/${kumarInvoice}/void`, { date: '2026-05-25', reason: 'Wrong purchase order' }).expect(200)).body as Invoice & { voidEntry: { number: string } };
    expect(v).toMatchObject({ status: 'void', state: 'void' });
    expect(v.voidEntry.number).toMatch(/^JV\/2026-27\//);
    await as().post(`/invoices/${kumarInvoice}/void`, {}).expect(409);
    const tb = (await as().get('/reports/trial-balance?asOf=2026-05-31').expect(200)).body as { rows: { code: string; balanceDebit: number }[] };
    expect(tb.rows.find((r) => r.code === '1300')!.balanceDebit).toBe(0);
  });

  it('lists by state with what is outstanding and overdue, for those who can read invoices', async () => {
    // Issued, unpaid and due long ago
    const late = await draft({ contactId: contact.bluewave, issueDate: '2026-05-01', dueDate: '2026-05-02', lines: [{ description: 'Audit', quantity: 1, unitPrice: 100_000, accountId: acc.sales }] });
    await as().post(`/invoices/${late.id}/issue`).expect(200);
    const all = (await as('auditor').get('/invoices').expect(200)).body as { total: number; summary: { outstanding: number; overdue: number }; items: { state: string; number: string | null }[] };
    expect(all.total).toBe(4);
    expect(all.summary).toEqual({ outstanding: 100_000, overdue: 100_000 });
    // The USD invoice is overdue too, but the summary counts the base currency only
    expect((await as('auditor').get('/invoices?state=overdue').expect(200)).body.items.map((i: { number: string }) => i.number)).toEqual(['INV/2026-27/0002', 'INV/2026-27/0003']);
    expect((await as('auditor').get('/invoices?state=draft').expect(200)).body.total).toBe(1);
    expect((await as('auditor').get('/invoices?state=void').expect(200)).body.total).toBe(1);
    await as('auditor').post('/invoices', {}).expect(403);
  });

  it('keeps customers and items with invoices, and organisations apart', async () => {
    expect((await as().delete(`/contacts/${contact.kumar}`).expect(409)).body.details.reason).toBe('in_use');
    expect((await as().delete(`/items/${dev}`).expect(409)).body.details.reason).toBe('in_use');
    await as('ownerB', orgB).get(`/invoices/${kumarInvoice}`).expect(404);
    expect((await as('ownerB', orgB).get('/invoices').expect(200)).body.total).toBe(0);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'org.invoice.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.invoice.create', 'org.invoice.issue', 'org.invoice.void']));
  });
});
