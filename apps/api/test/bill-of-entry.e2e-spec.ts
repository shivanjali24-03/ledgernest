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
  subtotal: number;
  taxTotal: number;
  total: number;
  billOfEntry: { number: string; portCode: string } | null;
  lines: { taxGroup: { name: string } | null }[];
};

describe('Bills of entry for imported goods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let customs = '';
  let abroad = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const boe = { number: '1234567', date: '2026-06-08', portCode: 'innsa1' };
  const lines = () => [
    {
      description:
        'CNC spindle parts: value for IGST (assessable value and duties)',
      quantity: 1,
      unitPrice: 11_10_000_00,
      taxGroupId: gst18,
      accountId: expense,
    },
    {
      description: 'Basic customs duty 10%',
      quantity: 1,
      unitPrice: 1_00_000_00,
      accountId: expense,
    },
    {
      description: 'Social welfare surcharge',
      quantity: 1,
      unitPrice: 10_000_00,
      accountId: expense,
    },
  ];
  const bill = (body: object) =>
    post('/bills', {
      contactId: customs,
      billDate: '2026-06-10',
      vendorReference: 'BE 1234567',
      billOfEntry: boe,
      lines: lines(),
      ...body,
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
          name: `BOE ${run}`,
          slug: `boe-${run}`,
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
    await post('/currencies', { code: 'USD' }).expect(201);
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
    customs = (
      await post('/contacts', {
        name: 'Commissioner of Customs, JNCH',
        isCustomer: false,
        isVendor: true,
      }).expect(201)
    ).body.id;
    abroad = (
      await post('/contacts', {
        name: 'Shenzhen Precision Ltd',
        isCustomer: false,
        isVendor: true,
        currency: 'USD',
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

  it('owes customs the duties and the IGST, not the value of the goods', async () => {
    const b = (await bill({}).expect(201)).body as Bill;
    expect(b.billOfEntry).toMatchObject({
      number: '1234567',
      portCode: 'INNSA1',
    });
    // IGST even though customs is in no state: an import is inter-state
    expect(b.lines[0]!.taxGroup?.name).toBe('IGST 18%');
    expect(b).toMatchObject({
      subtotal: 1_10_000_00,
      taxTotal: 1_99_800_00,
      total: 3_09_800_00,
    });
    await post(`/bills/${b.id}/record`).expect(200);
    const entry = await entryOf(b.id);
    const net = (code: string) =>
      entry
        .filter((l) => l.account.code === code)
        .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    // The duties are cost; the assessable value comes back off
    expect(net('5100')).toBe(1_10_000_00);
    expect(net('2000')).toBe(-3_09_800_00);
    const r = (
      await get('/reports/gst/gstr-3b?from=2026-06-01&to=2026-06-30').expect(
        200,
      )
    ).body as { itc: { igst: number } };
    expect(r.itc.igst).toBe(1_99_800_00);
  });

  it('refuses a bill of entry under reverse charge, in a foreign currency, or without an IGST line', async () => {
    const reason = async (body: object) =>
      ((await bill(body).expect(400)).body as { details: { reason: string } })
        .details.reason;
    expect(await reason({ reverseCharge: true })).toBe('boe_reverse_charge');
    expect(await reason({ contactId: abroad })).toBe('boe_currency');
    expect(await reason({ lines: [lines()[1]] })).toBe('boe_no_igst');
    const bad = (
      await bill({ billOfEntry: { ...boe, portCode: 'NHAVA' } }).expect(400)
    ).body as { details: { field: string }[] };
    expect(bad.details.map((d) => d.field)).toContain('billOfEntry.portCode');
  });
});
