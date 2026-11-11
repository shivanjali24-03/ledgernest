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
type Bill = { id: string; lines: { id: string }[] };
type Note = {
  id: string;
  status: string;
  total: number;
  taxTotal: number;
  currency: string | null;
  rate: string | null;
  remaining: number;
  journalEntry: { id: string };
};

/** Debit notes on goods kept in stock, on GST that couldn't be claimed, and on bills in another currency */
describe('Debit notes: stock, blocked credit, foreign currency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  let token = '';
  let org = '';
  let gst18 = '';
  let vendor = '';
  let abroad = '';
  let rod = '';
  let phone = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const record = async (contactId: string, lines: object[]) => {
    const b = (
      await post('/bills', {
        contactId,
        billDate: '2026-06-02',
        vendorReference: `V-${randomUUID().slice(0, 6)}`,
        lines,
      }).expect(201)
    ).body as Bill;
    await post(`/bills/${b.id}/record`).expect(200);
    // The lines as recorded
    return (await get(`/bills/${b.id}`).expect(200)).body as Bill;
  };
  const tb = async (accountId: string) => {
    const r = (
      (await get('/reports/trial-balance?asOf=2026-06-30').expect(200))
        .body as {
        rows: {
          accountId: string;
          balanceDebit: number;
          balanceCredit: number;
        }[];
      }
    ).rows.find((x) => x.accountId === accountId);
    return r ? r.balanceDebit - r.balanceCredit : 0;
  };
  const onHand = async (itemId: string) =>
    (
      (await get(`/inventory/items/${itemId}/movements`).expect(200)).body as {
        movements: { kind: string; onHand: string; valueOnHand: number }[];
      }
    ).movements;
  const entry = async (id: string) =>
    prisma.journalLine.findMany({
      where: { entryId: id },
      select: {
        debit: true,
        credit: true,
        taxRateId: true,
        accountId: true,
        foreignDebit: true,
        foreignCredit: true,
      },
    });

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
          name: `Debit returns ${run}`,
          slug: `debit-returns-${run}`,
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
    await post('/currencies', { code: 'USD' }).expect(201);
    await auth(http().put('/api/v1/currencies/USD/rates/2026-06-01'))
      .send({ rate: '85' })
      .expect(200);
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['stock', { code: '1500', type: 'asset', subtype: 'inventory' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'usdCreditors',
        {
          code: '2050',
          type: 'liability',
          subtype: 'accounts_payable',
          currency: 'USD',
        },
      ],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
      [
        'staff',
        { code: '5300', type: 'expense', subtype: 'operating_expense' },
      ],
      [
        'software',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const)
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    vendor = (
      await post('/contacts', {
        name: 'Patil Steels',
        isCustomer: false,
        isVendor: true,
        taxId: gstin('27ABZPS6519M1Z'),
      }).expect(201)
    ).body.id;
    abroad = (
      await post('/contacts', {
        name: 'Atlassian Pty',
        isCustomer: false,
        isVendor: true,
        currency: 'USD',
      }).expect(201)
    ).body.id;
    const item = async (body: object) =>
      (
        await post('/items', {
          kind: 'goods',
          unit: 'NOS',
          trackStock: true,
          inventoryAccountId: acc.stock,
          cogsAccountId: acc.cogs,
          ...body,
        }).expect(201)
      ).body.id as string;
    rod = await item({ name: 'Steel rod', trackBatches: true });
    phone = await item({ name: 'Phone X', trackSerials: true });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('sends goods back out of stock, from the batch they came in, at what they cost; voiding brings them back', async () => {
    const b = await record(vendor, [
      {
        itemId: rod,
        description: 'Steel rod',
        quantity: 10,
        unitPrice: 100_00,
        taxGroupId: gst18,
        accountId: acc.stock,
        batchNo: 'B-1',
      },
    ]);
    expect(await tb(acc.stock)).toBe(1_000_00);
    const n = (
      await post('/debit-notes', {
        billId: b.id,
        date: '2026-06-05',
        reason: 'Four rods bent',
        lines: [{ billLineId: b.lines[0]!.id, quantity: '4' }],
      }).expect(201)
    ).body as Note;
    expect(n).toMatchObject({ total: 472_00, taxTotal: 72_00 });
    expect(await tb(acc.stock)).toBe(600_00);
    const moves = await onHand(rod);
    expect(moves.at(-1)).toMatchObject({
      kind: 'debit_note',
      onHand: '6',
      valueOnHand: 600_00,
    });
    const batches = (await get(`/items/${rod}/batches`).expect(200)).body as {
      batchNo: string;
      onHand: string;
    }[];
    expect(batches.find((x) => x.batchNo === 'B-1')?.onHand).toBe('6');
    // Not more than the bill line has left
    expect(
      (
        await post('/debit-notes', {
          billId: b.id,
          date: '2026-06-05',
          lines: [{ billLineId: b.lines[0]!.id, quantity: '7' }],
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'over_credited' });
    await post(`/debit-notes/${n.id}/void`, { date: '2026-06-10' }).expect(200);
    expect(await tb(acc.stock)).toBe(1_000_00);
    expect((await onHand(rod)).at(-1)).toMatchObject({
      kind: 'debit_note_void',
      onHand: '10',
      valueOnHand: 1_000_00,
    });
  });

  it('sends back the units with serial numbers that came in on the bill', async () => {
    const b = await record(vendor, [
      {
        itemId: phone,
        description: 'Phone X',
        quantity: 2,
        unitPrice: 10_000_00,
        taxGroupId: gst18,
        accountId: acc.stock,
        serials: ['IMEI-1', 'IMEI-2'],
      },
    ]);
    const send = (serials: string[]) =>
      post('/debit-notes', {
        billId: b.id,
        date: '2026-06-06',
        lines: [{ billLineId: b.lines[0]!.id, quantity: '1', serials }],
      });
    expect((await send(['IMEI-9']).expect(400)).body.details).toMatchObject({
      reason: 'serial_not_bought',
    });
    expect((await send([]).expect(400)).body.details).toMatchObject({
      reason: 'serials_count',
    });
    const n = (await send(['imei-2']).expect(201)).body as Note;
    const status = async (s: string) =>
      (
        (await get(`/inventory/serials/${s}`).expect(200)).body as {
          status: string;
        }[]
      )[0]?.status;
    expect(await status('IMEI-2')).toBe('returned');
    expect(await status('IMEI-1')).toBe('in_stock');
    await post(`/debit-notes/${n.id}/void`, {}).expect(200);
    expect(await status('IMEI-2')).toBe('in_stock');
  });

  it('takes GST that couldn’t be claimed off the cost, not off input tax', async () => {
    const b = await record(vendor, [
      {
        description: 'Staff lunch',
        quantity: 1,
        unitPrice: 1_000_00,
        taxGroupId: gst18,
        accountId: acc.staff,
        itc: 'blocked',
      },
    ]);
    expect(await tb(acc.staff)).toBe(1_180_00);
    const n = (
      await post('/debit-notes', {
        billId: b.id,
        date: '2026-06-07',
        lines: [{ billLineId: b.lines[0]!.id, quantity: '1' }],
      }).expect(201)
    ).body as Note;
    expect(n.total).toBe(1_180_00);
    expect(await tb(acc.staff)).toBe(0);
    expect((await entry(n.journalEntry.id)).filter((l) => l.taxRateId)).toEqual(
      [],
    );
  });

  it('credits a bill in dollars at its own rate, and takes the refund at the day’s rate', async () => {
    const b = await record(abroad, [
      {
        description: 'Jira licences',
        quantity: 1,
        unitPrice: 100_00,
        accountId: acc.software,
      },
    ]);
    expect(await tb(acc.software)).toBe(8_500_00);
    await post('/payments/payments', {
      contactId: abroad,
      date: '2026-06-03',
      bankAccountId: acc.bank,
      amount: 100_00,
      rate: '85',
      allocations: [{ billId: b.id, amount: 100_00 }],
    }).expect(201);
    const n = (
      await post('/debit-notes', {
        billId: b.id,
        date: '2026-06-08',
        reason: 'Seats not used',
        lines: [{ billLineId: b.lines[0]!.id, quantity: '0.4' }],
      }).expect(201)
    ).body as Note;
    expect(n).toMatchObject({ total: 40_00, currency: 'USD' });
    expect(Number(n.rate)).toBe(85);
    expect(await tb(acc.software)).toBe(8_500_00 - 3_400_00);
    const lines = await entry(n.journalEntry.id);
    const payable = lines.find((l) => l.accountId === acc.usdCreditors)!;
    expect(Number(payable.foreignDebit)).toBe(40_00);
    expect(Number(payable.debit)).toBe(3_400_00);
    // What's not on the bill comes back to the bank, in rupees at the day's rate
    const left = n.remaining;
    expect(left).toBeGreaterThan(0);
    const bankBefore = await tb(acc.bank);
    const r = (
      await post(`/debit-notes/${n.id}/refund`, {
        date: '2026-06-20',
        bankAccountId: acc.bank,
        amount: left,
        rate: '86',
      }).expect(200)
    ).body as Note;
    expect(r.remaining).toBe(0);
    expect((await tb(acc.bank)) - bankBefore).toBe(Math.round((left * 86) / 1));
  });
});
