import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { InvoiceRemindersService } from '../src/invoices/invoice-reminders.service.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Aging = {
  baseCurrency: string;
  contacts: {
    contact: { name: string };
    currency: string | null;
    buckets: Record<string, number>;
    total: number;
    advance: number;
    baseTotal: number;
    documents: {
      number: string;
      bucket: string;
      daysOverdue: number;
      outstanding: number;
    }[];
  }[];
  totals: {
    buckets: Record<string, number>;
    total: number;
    advance: number;
    net: number;
  };
};

describe('Aging reports (e2e)', () => {
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
    dueDate: string,
    unitPrice: number,
  ) => {
    const d = (
      await as()
        .post('/invoices', {
          contactId,
          issueDate,
          dueDate,
          lines: [
            {
              description: 'Services',
              quantity: 1,
              unitPrice,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body;
    return (await as().post(`/invoices/${d.id}/issue`).expect(200)).body
      .id as string;
  };
  const aging = async (side: string, asOf: string, who = 'owner') =>
    (await as(who).get(`/reports/aging?side=${side}&asOf=${asOf}`).expect(200))
      .body as Aging;
  const receive = (
    contactId: string,
    date: string,
    amount: number,
    allocations: object[] = [],
  ) =>
    as()
      .post('/payments/receipts', {
        contactId,
        date,
        bankAccountId: acc.bank,
        amount,
        allocations,
      })
      .expect(201);

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
          name: `Aging ${run}`,
          slug: `aging-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['viewer', 'viewer'],
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
      .put('/currencies/USD/rates/2026-04-01', { rate: '90' })
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
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
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
    contact.sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Supplies',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
    inv.a = await issue(contact.kumar, '2026-04-10', '2026-04-20', 100_000);
    inv.d = await issue(contact.kumar, '2026-05-01', '2026-05-01', 20_000);
    inv.b = await issue(contact.kumar, '2026-06-01', '2026-06-15', 50_000);
    inv.c = await issue(contact.kumar, '2026-06-20', '2026-07-20', 30_000);
    inv.n = await issue(contact.northwind, '2026-05-10', '2026-05-15', 50_000);
    await receive(contact.kumar, '2026-06-25', 40_000, [
      { invoiceId: inv.a, amount: 40_000 },
    ]);
    await receive(contact.kumar, '2026-06-28', 5_000);
    await receive(contact.kumar, '2026-07-05', 50_000, [
      { invoiceId: inv.b, amount: 50_000 },
    ]);
    await as()
      .post(`/invoices/${inv.d}/void`, {
        date: '2026-07-01',
        reason: 'Raised twice',
      })
      .expect(200);
    const bill = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          billDate: '2026-04-01',
          dueDate: '2026-04-01',
          lines: [
            {
              description: 'Rent',
              quantity: 1,
              unitPrice: 25_000,
              accountId: acc.rent,
            },
          ],
        })
        .expect(201)
    ).body;
    await as().post(`/bills/${bill.id}/record`).expect(200);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('ages receivables by days past due, per customer and currency, less what was paid by then', async () => {
    const a = await aging('receivables', '2026-06-30');
    expect(a.contacts.map((c) => [c.contact.name, c.currency])).toEqual([
      ['Kumar Logistics', null],
      ['Northwind Inc.', 'USD'],
    ]);
    const [kumar, northwind] = a.contacts;
    // A: 1,000 less 400 paid, 71 days late. D: 60 days (voided only on 1 July). B: 15 days. C: not due yet.
    expect(kumar!.buckets).toEqual({
      current: 30_000,
      d1_30: 50_000,
      d31_60: 20_000,
      d61_90: 60_000,
      over_90: 0,
    });
    expect(kumar!).toMatchObject({ total: 160_000, advance: 5_000 });
    expect(
      kumar!.documents.map((d) => [d.bucket, d.daysOverdue, d.outstanding]),
    ).toEqual([
      ['d61_90', 71, 60_000],
      ['d31_60', 60, 20_000],
      ['d1_30', 15, 50_000],
      ['current', 0, 30_000],
    ]);
    // USD 500 at 90, 46 days late
    expect(northwind!).toMatchObject({ total: 50_000, baseTotal: 4_500_000 });
    expect(northwind!.buckets.d31_60).toBe(50_000);
    expect(a.totals).toEqual({
      buckets: {
        current: 30_000,
        d1_30: 50_000,
        d31_60: 4_520_000,
        d61_90: 60_000,
        over_90: 0,
      },
      total: 4_660_000,
      advance: 5_000,
      net: 4_655_000,
    });
  });

  it('a later day sees the later payment and the void, and the oldest debt moves on', async () => {
    const kumar = (await aging('receivables', '2026-07-21')).contacts.find(
      (c) => c.contact.name === 'Kumar Logistics',
    )!;
    expect(kumar.buckets).toEqual({
      current: 0,
      d1_30: 30_000,
      d31_60: 0,
      d61_90: 0,
      over_90: 60_000,
    });
    expect(kumar.documents).toHaveLength(2);
    // Before anything was issued, nobody owes anything
    expect((await aging('receivables', '2026-04-01')).contacts).toEqual([]);
  });

  it('ages payables the same way', async () => {
    const a = await aging('payables', '2026-07-15');
    expect(a.contacts).toHaveLength(1);
    expect(a.contacts[0]!).toMatchObject({
      contact: { name: 'Sharma Supplies' },
      total: 25_000,
    });
    expect(a.contacts[0]!.documents[0]!).toMatchObject({
      number: 'BILL/2026-27/0001',
      bucket: 'over_90',
      daysOverdue: 105,
    });
  });

  it('exports CSV, and needs report permissions', async () => {
    const r = await as()
      .get('/reports/aging/export?side=receivables&asOf=2026-06-30')
      .expect(200);
    expect(r.headers['content-disposition']).toContain(
      'receivables-aging-2026-06-30.csv',
    );
    const lines = r.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines[0]).toBe(
      'contact,document,date,due_date,days_overdue,currency,current,1_30,31_60,61_90,over_90,advance,net',
    );
    expect(lines[1]).toBe(
      'Kumar Logistics,INV/2026-27/0001,2026-04-10,2026-04-20,71,INR,,,,600.00,,,600.00',
    );
    expect(lines).toContain(
      'Kumar Logistics total,,,,,INR,300.00,500.00,200.00,600.00,0.00,50.00,1550.00',
    );
    expect(lines.at(-1)).toBe(
      'Total (INR),,,,,INR,300.00,500.00,45200.00,600.00,0.00,50.00,46550.00',
    );
    await as('viewer').get('/reports/aging?side=receivables').expect(200);
    await as().get('/reports/aging?side=sideways').expect(400);
  });

  type Statement = {
    contact: { name: string };
    sections: {
      currency: string;
      opening: number;
      debits: number;
      credits: number;
      closing: number;
      lines: {
        date: string;
        kind: string;
        voided: string | null;
        number: string;
        debit: number;
        credit: number;
        balance: number;
      }[];
    }[];
  };
  const statement = async (q: string, who = 'owner') =>
    (await as(who).get(`/reports/statement?${q}`).expect(200))
      .body as Statement;

  it('makes a customer’s statement: brought forward, each document and void, carried down', async () => {
    const s = await statement(
      `contactId=${contact.kumar}&side=receivables&from=2026-06-01&to=2026-07-31`,
    );
    expect(s.contact.name).toBe('Kumar Logistics');
    expect(s.sections).toHaveLength(1);
    const [inr] = s.sections;
    expect(inr).toMatchObject({
      currency: 'INR',
      opening: 120_000,
      debits: 80_000,
      credits: 115_000,
      closing: 85_000,
    });
    expect(
      inr!.lines.map((l) => [
        l.date,
        l.kind,
        l.voided,
        l.number,
        l.debit,
        l.credit,
        l.balance,
      ]),
    ).toEqual([
      ['2026-06-01', 'invoice', null, 'INV/2026-27/0003', 50_000, 0, 170_000],
      ['2026-06-20', 'invoice', null, 'INV/2026-27/0004', 30_000, 0, 200_000],
      ['2026-06-25', 'receipt', null, 'RCT/2026-27/0001', 0, 40_000, 160_000],
      ['2026-06-28', 'receipt', null, 'RCT/2026-27/0002', 0, 5_000, 155_000],
      ['2026-07-01', 'void', 'invoice', 'INV/2026-27/0002', 0, 20_000, 135_000],
      ['2026-07-05', 'receipt', null, 'RCT/2026-27/0003', 0, 50_000, 85_000],
    ]);
    // A foreign-currency customer's statement stays in their currency
    const usd = await statement(
      `contactId=${contact.northwind}&side=receivables&from=2026-04-01&to=2026-12-31`,
    );
    expect(usd.sections.map((x) => [x.currency, x.closing])).toEqual([
      ['USD', 50_000],
    ]);
    await as('viewer')
      .get(
        `/reports/statement?contactId=${contact.kumar}&side=receivables&from=2026-06-01&to=2026-07-31`,
      )
      .expect(200);
  });

  it('makes a vendor’s statement, and turns away bad requests', async () => {
    const s = await statement(
      `contactId=${contact.sharma}&side=payables&from=2026-04-01&to=2026-04-30`,
    );
    expect(s.sections[0]).toMatchObject({
      opening: 0,
      closing: 25_000,
      lines: [{ kind: 'bill', number: 'BILL/2026-27/0001', debit: 25_000 }],
    });
    // Nothing yet in March
    expect(
      (
        await statement(
          `contactId=${contact.sharma}&side=payables&from=2026-03-01&to=2026-03-31`,
        )
      ).sections,
    ).toEqual([]);
    await as()
      .get(
        `/reports/statement?contactId=${randomUUID()}&side=payables&from=2026-04-01&to=2026-04-30`,
      )
      .expect(404);
    await as()
      .get(
        `/reports/statement?contactId=${contact.sharma}&side=payables&from=2026-05-01&to=2026-04-30`,
      )
      .expect(400);
  });

  it('downloads a statement as CSV or PDF', async () => {
    const q = `contactId=${contact.kumar}&side=receivables&from=2026-06-01&to=2026-07-31`;
    const csv = await as().get(`/reports/statement/export?${q}`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(
      'statement-kumar-logistics-2026-06-01-2026-07-31.csv',
    );
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines[1]).toBe('2026-06-01,Balance brought forward,,,INR,,,1200.00');
    expect(lines).toContain(
      '2026-07-01,Invoice voided,INV/2026-27/0002,,INR,,200.00,1350.00',
    );
    expect(lines.at(-1)).toBe(
      '2026-07-31,Balance carried down,,,INR,800.00,1150.00,850.00',
    );
    const pdf = await as()
      .get(`/reports/statement/export?${q}&format=pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Statement of account: Kumar Logistics) Tj');
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org, action: 'org.report.export' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.entityId).toBe('statement');
  });

  it('emails a statement as a PDF, when email is set up', async () => {
    const body = {
      contactId: contact.kumar,
      side: 'receivables',
      from: '2026-06-01',
      to: '2026-07-31',
    };
    delete process.env.SMTP_URL;
    expect(
      (await as().post('/reports/statement/email', body).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'mail_off' });
    process.env.SMTP_URL = 'json';
    try {
      // Kumar has no email on file, so one must be given
      expect(
        (await as().post('/reports/statement/email', body).expect(400)).body
          .details,
      ).toMatchObject({ reason: 'no_email' });
      const r = await as()
        .post('/reports/statement/email', {
          ...body,
          email: 'accounts@kumar.example',
          message: 'Please let us know if anything looks wrong.',
        })
        .expect(200);
      expect(r.body).toEqual({ sentTo: 'accounts@kumar.example' });
      const mail = app.get(MailService).captured.at(-1)!;
      expect(mail).toEqual({
        to: ['accounts@kumar.example'],
        subject: `Statement of account from Aging ${run}, 2026-06-01 to 2026-07-31`,
        attachments: ['statement-kumar-logistics-2026-06-01-2026-07-31.pdf'],
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: org, action: 'org.statement.email' },
      });
      expect(audit).toMatchObject({
        entityType: 'contact',
        entityId: contact.kumar,
        actorId: users.owner!.id,
      });
      // Viewers can read reports but not send them
      await as('viewer')
        .post('/reports/statement/email', {
          ...body,
          email: 'accounts@kumar.example',
        })
        .expect(403);
      await as()
        .post('/reports/statement/email', { ...body, email: 'not-an-email' })
        .expect(400);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('sends payment reminders for invoices with something still owed', async () => {
    process.env.SMTP_URL = 'json';
    try {
      // Paid in full, or voided: nothing to remind about
      for (const id of [inv.b, inv.d])
        expect(
          (
            await as()
              .post(`/invoices/${id}/remind`, { email: 'a@kumar.example' })
              .expect(409)
          ).body.details,
        ).toMatchObject({ reason: 'nothing_owed' });
      expect(
        (await as().post(`/invoices/${inv.c}/remind`, {}).expect(400)).body
          .details,
      ).toMatchObject({ reason: 'no_email' });
      const r = await as()
        .post(`/invoices/${inv.c}/remind`, {
          email: 'a@kumar.example',
          message: 'Gentle nudge.',
        })
        .expect(200);
      expect(r.body).toMatchObject({ sentTo: 'a@kumar.example', reminders: 1 });
      expect(app.get(MailService).captured.at(-1)).toEqual({
        to: ['a@kumar.example'],
        subject: `Payment reminder: invoice INV/2026-27/0004 from Aging ${run}`,
        attachments: [],
      });
      await as()
        .post(`/invoices/${inv.c}/remind`, { email: 'a@kumar.example' })
        .expect(200);
      const got = (await as().get(`/invoices/${inv.c}`).expect(200)).body;
      expect(got.reminders).toBe(2);
      expect(got.lastRemindedAt).toBeTruthy();
      expect(
        await prisma.auditLog.count({
          where: { organizationId: org, action: 'org.invoice.remind' },
        }),
      ).toBe(2);
      await as('viewer')
        .post(`/invoices/${inv.c}/remind`, { email: 'a@kumar.example' })
        .expect(403);
      delete process.env.SMTP_URL;
      expect(
        (
          await as()
            .post(`/invoices/${inv.c}/remind`, { email: 'a@kumar.example' })
            .expect(409)
        ).body.details,
      ).toMatchObject({ reason: 'mail_off' });
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('sends automatic reminders under the organisation’s policy', async () => {
    expect((await as().get('/reminder-policy').expect(200)).body).toEqual({
      enabled: false,
      firstAfterDays: 3,
      repeatEveryDays: 7,
      maxReminders: 3,
    });
    const policy = {
      enabled: true,
      firstAfterDays: 3,
      repeatEveryDays: 7,
      maxReminders: 3,
    };
    await as()
      .put('/reminder-policy', { ...policy, maxReminders: 0 })
      .expect(400);
    await as('viewer').put('/reminder-policy', policy).expect(403);
    expect(
      (await as().put('/reminder-policy', policy).expect(200)).body,
    ).toEqual(policy);
    await as('viewer').get('/reminder-policy').expect(403);
    // Kumar now has an email; C already had two reminders by hand, the last a few days before the run
    await prisma.contact.update({
      where: { id: contact.kumar },
      data: { email: 'accounts@kumar.example' },
    });
    await prisma.invoice.update({
      where: { id: inv.c },
      data: { lastRemindedAt: new Date('2026-11-28T06:00:00Z') },
    });
    const svc = app.get(InvoiceRemindersService);
    const count = async (id: string) =>
      (await prisma.invoice.findUniqueOrThrow({ where: { id } })).reminders;
    expect(await svc.runDue(new Date('2026-12-01T06:00:00Z'))).toBe(0); // email isn't set up
    process.env.SMTP_URL = 'json';
    try {
      // A is overdue and never reminded; C was reminded 3 days ago; Northwind has no email
      expect(await svc.runDue(new Date('2026-12-01T06:00:00Z'))).toBe(1);
      expect(await count(inv.a)).toBe(1);
      expect(await svc.runDue(new Date('2026-12-01T09:00:00Z'))).toBe(0);
      const auto = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org,
          action: 'org.invoice.remind',
          entityId: inv.a,
        },
      });
      expect(auto.actorId).toBeNull();
      expect(auto.after).toMatchObject({ automatic: true });
      // A week on: A again, and C's third (its last)
      expect(await svc.runDue(new Date('2026-12-08T06:00:00Z'))).toBe(2);
      expect([await count(inv.a), await count(inv.c)]).toEqual([2, 3]);
      expect(await svc.runDue(new Date('2026-12-15T06:00:00Z'))).toBe(1);
      expect(await svc.runDue(new Date('2026-12-22T06:00:00Z'))).toBe(0);
      // Off means off
      await as()
        .put('/reminder-policy', { ...policy, enabled: false, maxReminders: 9 })
        .expect(200);
      expect(await svc.runDue(new Date('2027-01-30T06:00:00Z'))).toBe(0);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('sums sales and purchases by customer, vendor or item, in the base currency', async () => {
    type Sales = {
      rows: {
        id: string | null;
        name: string | null;
        documents: number;
        quantity: string | null;
        net: number;
        tax: number;
        total: number;
      }[];
      totals: { net: number; tax: number; total: number };
    };
    const sales = async (q: string, who = 'owner') =>
      (await as(who).get(`/reports/sales?${q}`).expect(200)).body as Sales;
    // Northwind's USD 500 at 90 first; Kumar's three issued invoices (the voided one left out)
    const byCustomer = await sales(
      'side=sales&by=contact&from=2026-04-01&to=2026-07-31',
    );
    expect(
      byCustomer.rows.map((r) => [r.name, r.documents, r.net, r.total]),
    ).toEqual([
      ['Northwind Inc.', 1, 4_500_000, 4_500_000],
      ['Kumar Logistics', 3, 180_000, 180_000],
    ]);
    expect(byCustomer.totals.total).toBe(4_680_000);
    const byItem = await sales(
      'side=sales&by=item&from=2026-04-01&to=2026-07-31',
    );
    expect(byItem.rows).toEqual([
      {
        id: null,
        name: null,
        documents: 4,
        quantity: null,
        net: 4_680_000,
        tax: 0,
        total: 4_680_000,
      },
    ]);
    // Only what was invoiced in the dates
    expect(
      (
        await sales('side=sales&by=contact&from=2026-06-01&to=2026-06-30')
      ).rows.map((r) => [r.name, r.documents, r.total]),
    ).toEqual([['Kumar Logistics', 2, 80_000]]);
    expect(
      (
        await sales(
          'side=purchases&by=contact&from=2026-04-01&to=2026-04-30',
          'viewer',
        )
      ).rows.map((r) => [r.name, r.documents, r.total]),
    ).toEqual([['Sharma Supplies', 1, 25_000]]);
    const csv = await as()
      .get(
        '/reports/sales/export?side=sales&by=contact&from=2026-04-01&to=2026-07-31',
      )
      .expect(200);
    expect(csv.headers['content-disposition']).toContain(
      'sales-by-customer-2026-04-01-2026-07-31.csv',
    );
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.replaceAll('"', ''));
    expect(lines[0]).toBe('Customer,Documents,Net,Tax,Total');
    expect(lines.at(-1)).toBe('Total,,46800.00,0.00,46800.00');
    await as('viewer')
      .get(
        '/reports/sales/export?side=sales&by=contact&from=2026-04-01&to=2026-07-31',
      )
      .expect(403);
    await as()
      .get('/reports/sales?side=sideways&from=2026-04-01&to=2026-07-31')
      .expect(400);
  });
});
