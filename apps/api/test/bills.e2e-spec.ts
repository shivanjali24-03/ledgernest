import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Bill = { id: string; number: string | null; status: string; state: string; subtotal: number; taxTotal: number; total: number; dueDate: string; vendorReference: string | null; journalEntry: { id: string } | null; taxBreakdown: { name: string; amount: number }[]; lines: { taxGroup: { name: string } | null }[] };
type Entry = { reference: string; lines: { account: { code: string }; debit: number; credit: number; currency: string | null; foreignCredit: number }[] };

describe('Purchase bills (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';
  let gst18 = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) => auth(http().put(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
  const draft = async (body: object) => (await as().post('/bills', body).expect(201)).body as Bill;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (await prisma.organization.create({ data: { name: `Bills ${run}`, slug: `bills-${run}`, country: 'IN', region: 'Maharashtra', fiscalYearStartMonth: 4 } })).id;
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
    for (const [key, body] of [
      ['creditors', { code: '2000', type: 'liability', subtype: 'accounts_payable' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
      ['laptops', { code: '1710', type: 'asset', subtype: 'fixed_asset' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (await as().post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = ((await as().post('/taxes/gst-setup').expect(200)).body.groups as { id: string; name: string }[]).find((g) => g.name === 'GST 18%')!.id;
    for (const [key, body] of [
      ['sharma', { name: 'Sharma Office Supplies', isCustomer: false, isVendor: true, taxId: gstin('27ABZPS6519M1Z'), billingAddress: { country: 'IN' }, paymentTermsDays: 7 }],
      ['dell', { name: 'Dell Technologies India', isCustomer: false, isVendor: true, taxId: gstin('29AAACD4382A1Z'), billingAddress: { country: 'IN' } }],
      ['aws', { name: 'Amazon Web Services', isCustomer: false, isVendor: true, currency: 'USD' }],
      ['kumar', { name: 'Kumar Logistics', isCustomer: true, isVendor: false }],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  let sharmaBill = '';

  it('drafts a bill from a vendor in the same state: CGST + SGST input credit, due on their terms', async () => {
    const b = await draft({ contactId: contact.sharma, vendorReference: 'SOS/887', billDate: '2026-05-04', lines: [{ description: 'Office rent, May', quantity: 1, unitPrice: 5_000_000, taxGroupId: gst18, accountId: acc.rent }] });
    sharmaBill = b.id;
    expect(b).toMatchObject({ status: 'draft', number: null, vendorReference: 'SOS/887', subtotal: 5_000_000, taxTotal: 900_000, total: 5_900_000, dueDate: '2026-05-11' });
    expect(b.taxBreakdown.map((x) => x.name)).toEqual(['CGST 9%', 'SGST 9%']);
  });

  it('charges IGST from a vendor in another state, and buys assets as well as expenses', async () => {
    const b = await draft({ contactId: contact.dell, billDate: '2026-05-06', lines: [{ description: 'Latitude 5440', quantity: 2, unitPrice: 7_200_000, taxGroupId: gst18, accountId: acc.laptops }] });
    expect(b.lines[0]!.taxGroup!.name).toBe('IGST 18%');
    expect(b.total).toBe(16_992_000);
  });

  it('refuses customers and income accounts', async () => {
    const reason = async (body: object) => (await as().post('/bills', { billDate: '2026-05-06', contactId: contact.sharma, ...body }).expect(400)).body.details.reason;
    expect(await reason({ contactId: contact.kumar, lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.rent }] })).toBe('not_vendor');
    expect(await reason({ lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.sales }] })).toBe('not_expense');
  });

  it('records the bill: expenses and input credit against the payable, under the vendor’s reference', async () => {
    const b = (await as().post(`/bills/${sharmaBill}/record`).expect(200)).body as Bill;
    expect(b).toMatchObject({ number: 'BILL/2026-27/0001', status: 'open' });
    const e = (await as().get(`/journals/${b.journalEntry!.id}`).expect(200)).body as Entry;
    expect(e.reference).toBe('SOS/887');
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ['5300', 5_000_000, 0],
      ['1310', 450_000, 0],
      ['1320', 450_000, 0],
      ['2000', 0, 5_900_000],
    ]);
    await as().patch(`/bills/${sharmaBill}`, { contactId: contact.sharma, billDate: '2026-05-04', lines: [{ description: 'x', quantity: 1, unitPrice: 1, accountId: acc.rent }] }).expect(409);
    expect((await as().post(`/journals/${b.journalEntry!.id}/reverse`, {}).expect(409)).body.details.reason).toBe('document_entry');
  });

  it('owes a foreign vendor in their currency', async () => {
    const b = await draft({ contactId: contact.aws, billDate: '2026-05-08', lines: [{ description: 'AWS, April', quantity: 1, unitPrice: 40_000, accountId: acc.rent }] });
    expect((await as().post(`/bills/${b.id}/record`).expect(409)).body.details.reason).toBe('no_payable_account');
    await as().post('/accounts', { code: '2050', name: `USD creditors ${run}`, type: 'liability', subtype: 'accounts_payable', currency: 'USD' }).expect(201);
    const r = (await as().post(`/bills/${b.id}/record`).expect(200)).body as Bill;
    const e = (await as().get(`/journals/${r.journalEntry!.id}`).expect(200)).body as Entry;
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit, l.currency, l.foreignCredit])).toEqual([
      ['5300', 3_600_000, 0, null, 0],
      ['2050', 0, 3_600_000, 'USD', 40_000],
    ]);
  });

  it('voids an unpaid bill and lists by state', async () => {
    const v = (await as().post(`/bills/${sharmaBill}/void`, { date: '2026-05-25', reason: 'Duplicate' }).expect(200)).body as Bill;
    expect(v).toMatchObject({ status: 'void', state: 'void' });
    const all = (await as('auditor').get('/bills').expect(200)).body as { total: number; summary: { outstanding: number } };
    expect(all.total).toBe(3);
    expect((await as('auditor').get('/bills?state=draft').expect(200)).body.total).toBe(1);
    expect((await as('auditor').get('/bills?state=overdue').expect(200)).body.total).toBe(1);
    await as('auditor').post('/bills', {}).expect(403);
    expect((await as().delete(`/contacts/${contact.sharma}`).expect(409)).body.details.reason).toBe('in_use');
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: org, action: { startsWith: 'org.bill.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.bill.create', 'org.bill.record', 'org.bill.void']));
  });
});
