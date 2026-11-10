import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Workspace = {
  bankLines: { id: string; description: string; amount: number }[];
  receipts: {
    statementLineId: string;
    invoiceNumber: string;
    contact: { name: string };
    balance: number;
    confidence: string;
  }[];
};

// A UPI payment from scanning the invoice's QR code (its note carries the number), a transfer for the other
// invoice's exact balance from the same customer, and a cash deposit that's neither
const STATEMENT = [
  'Date,Narration,Ref,Withdrawal,Deposit,Balance',
  '20/06/26,UPI/CR/412345678901/KUMAR LOGISTICS/okhdfcbank/Invoice INV/2026-27/0001,,,"1,180.00","11,180.00"',
  '22/06/26,NEFT CR KUMAR LOGISTICS PVT LTD,N1734,,"5,000.00","16,180.00"',
  '25/06/26,CASH DEPOSIT BRANCH 0042,,,700.00,"16,880.00"',
].join('\n');

describe('Banking: receipts from bank lines (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const acc: Record<string, string> = {};
  const inv: string[] = [];
  let org = '';
  let token = '';
  let kumar = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const get = (p: string) => auth(http().get(`/api/v1${p}`));
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const workspace = async () =>
    (await get(`/banking/reconcile/${acc.bank}?date=2026-06-30`).expect(200))
      .body as Workspace;

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
          name: `UPI match ${run}`,
          slug: `upi-match-${run}`,
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
    token = await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await post('/accounts', { name: `${key} ${run}`, ...body }).expect(201)
      ).body.id;
    }
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    kumar = (
      await post('/contacts', {
        name: 'Kumar Logistics',
        legalName: 'Kumar Logistics Private Limited',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id;
    for (const unitPrice of [1_180_00, 5_000_00]) {
      const d = (
        await post('/invoices', {
          contactId: kumar,
          issueDate: '2026-06-10',
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice,
              accountId: acc.sales,
            },
          ],
        }).expect(201)
      ).body as { id: string };
      await post(`/invoices/${d.id}/issue`).expect(200);
      inv.push(d.id);
    }
    await post('/banking/statements/import', {
      bankAccountId: acc.bank,
      fileName: 'june.csv',
      content: STATEMENT,
    }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('finds the invoice each payment pays: by the number a UPI note carries, or by the balance and the customer’s name', async () => {
    const ws = await workspace();
    const line = (text: string) =>
      ws.bankLines.find((l) => l.description.startsWith(text))!.id;
    expect(ws.receipts).toEqual([
      expect.objectContaining({
        statementLineId: line('UPI/CR'),
        invoiceNumber: 'INV/2026-27/0001',
        contact: expect.objectContaining({ name: 'Kumar Logistics' }),
        balance: 1_180_00,
        confidence: 'high',
      }),
      expect.objectContaining({
        statementLineId: line('NEFT CR'),
        invoiceNumber: 'INV/2026-27/0002',
        confidence: 'medium',
      }),
    ]);
  });

  it('records the receipt from the line in one go, already matched, and the invoice is paid', async () => {
    const ws = await workspace();
    const upi = ws.receipts.find((r) => r.confidence === 'high')!;
    const p = (
      await post('/banking/reconcile/receive', {
        statementLineId: upi.statementLineId,
        invoiceId: inv[0],
      }).expect(201)
    ).body as { date: string; amount: number; reference: string };
    expect(p).toMatchObject({ date: '2026-06-20', amount: 1_180_00 });
    expect(p.reference).toContain('UPI/CR/412345678901');
    expect((await get(`/invoices/${inv[0]}`).expect(200)).body.balance).toBe(0);
    const after = await workspace();
    expect(after.bankLines.map((l) => l.id)).not.toContain(upi.statementLineId);
    // The same line can't be taken twice, and money out isn't a receipt
    expect(
      (
        await post('/banking/reconcile/receive', {
          statementLineId: upi.statementLineId,
          invoiceId: inv[1],
        }).expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'line_not_unmatched' });
    // The other suggestion still stands
    expect(after.receipts.map((r) => r.invoiceNumber)).toEqual([
      'INV/2026-27/0002',
    ]);
  });
});
