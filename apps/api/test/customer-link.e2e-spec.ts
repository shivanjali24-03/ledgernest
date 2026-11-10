import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { MailService } from '../src/mail/mail.service.js';
import { msmeLateInterest, todayIn } from '@ledgernest/shared';

type Share = { token: string; views: number; lastViewedAt: string | null };
type Account = {
  organization: { name: string };
  customer: { name: string };
  invoices: { id: string; number: string; balance: number; state: string }[];
  totals: { currency: string; balance: number }[];
  upi: { link: string; amount: number; upiId: string } | null;
};

describe('Customer account links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const inv: string[] = [];
  let org = '';
  let kumar = '';
  let other = '';
  let otherInvoice = '';
  let vendor = '';
  let token = '';

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
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const visitor = (p: string) => http().get(`/api/v1/public/customers/${p}`);
  const issue = async (
    contactId: string,
    unitPrice: number,
    issueDate: string,
  ) => {
    const d = (
      await as()
        .post('/invoices', {
          contactId,
          issueDate,
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/invoices/${d.id}/issue`).expect(200);
    return d.id;
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
          name: `Links ${run}`,
          legalName: `Links Traders ${run}`,
          slug: `links-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          upiId: 'linkstraders@okhdfcbank',
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
          name: key,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    const contact = async (body: object) =>
      (await as().post('/contacts', body).expect(201)).body.id as string;
    kumar = await contact({
      name: 'Kumar Logistics',
      isCustomer: true,
      isVendor: false,
    });
    other = await contact({
      name: 'Bluewave Clinics',
      isCustomer: true,
      isVendor: false,
    });
    vendor = await contact({
      name: 'Sharma Supplies',
      isCustomer: false,
      isVendor: true,
    });
    inv.push(await issue(kumar, 1_180_00, '2026-06-01'));
    inv.push(await issue(kumar, 5_000_00, '2026-06-10'));
    otherInvoice = await issue(other, 900_00, '2026-06-12');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('makes one link per customer, for people who manage invoices', async () => {
    expect(
      (await as().post(`/contacts/${vendor}/share`).expect(400)).body.details,
    ).toMatchObject({ reason: 'not_customer' });
    await as('viewer').post(`/contacts/${kumar}/share`).expect(403);
    const s = (await as().post(`/contacts/${kumar}/share`).expect(200))
      .body as Share;
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    token = s.token;
    expect(
      ((await as().post(`/contacts/${kumar}/share`).expect(200)).body as Share)
        .token,
    ).toBe(token);
    const c = (await as().get(`/contacts/${kumar}`).expect(200)).body as {
      share: Share;
      shareToken?: string;
    };
    expect(c.share).toMatchObject({ token, views: 0 });
    expect(c).not.toHaveProperty('shareToken');
  });

  it('shows the customer everything they owe, with one UPI code for the total and each invoice’s PDF', async () => {
    const r = await visitor(token).expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    const a = r.body as Account;
    expect(a).toMatchObject({
      organization: { name: `Links Traders ${run}` },
      customer: { name: 'Kumar Logistics' },
      totals: [{ currency: 'INR', balance: 6_180_00 }],
      upi: { upiId: 'linkstraders@okhdfcbank', amount: 6_180_00 },
    });
    expect(a.invoices.map((i) => [i.number, i.balance])).toEqual([
      ['INV/2026-27/0001', 1_180_00],
      ['INV/2026-27/0002', 5_000_00],
    ]);
    expect(decodeURIComponent(a.upi!.link)).toContain(
      'am=6180.00&cu=INR&tn=Invoices INV/2026-27/0001, INV/2026-27/0002',
    );
    // Bluewave's invoice isn't there, and can't be had through this link
    expect(JSON.stringify(a)).not.toContain('Bluewave');
    await visitor(`${token}/invoices/${otherInvoice}/pdf`).expect(404);
    const pdf = await visitor(`${token}/invoices/${inv[0]}/pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(
      (
        (await as().get(`/contacts/${kumar}`).expect(200)).body as {
          share: Share;
        }
      ).share.views,
    ).toBe(1);
  });

  it('drops paid invoices, and with one left the UPI code carries its number', async () => {
    await as()
      .post('/payments/receipts', {
        contactId: kumar,
        date: '2026-06-20',
        bankAccountId: acc.bank,
        amount: 1_180_00,
        allocations: [{ invoiceId: inv[0], amount: 1_180_00 }],
      })
      .expect(201);
    const a = (await visitor(token).expect(200)).body as Account;
    expect(a.invoices.map((i) => i.number)).toEqual(['INV/2026-27/0002']);
    expect(decodeURIComponent(a.upi!.link)).toContain(
      'am=5000.00&cu=INR&tn=Invoice INV/2026-27/0002&tr=INV/2026-27/0002',
    );
  });

  it('adds MSMED Act interest on what is late, when the business is a micro or small enterprise', async () => {
    // Not an MSME: no interest
    expect((await visitor(token).expect(200)).body.msme).toBeNull();
    await prisma.organization.update({
      where: { id: org },
      data: {
        msmeCategory: 'micro',
        udyamNumber: 'UDYAM-MH-26-0012345',
        msmeBankRateBp: 550,
      },
    });
    const a = (await visitor(token).expect(200)).body as Account & {
      invoices: { msmeInterest: number }[];
      msme: { udyamNumber: string; interest: number };
    };
    const today = todayIn('Asia/Kolkata');
    const expected = msmeLateInterest(
      5_000_00,
      '2026-06-10',
      '2026-07-10',
      today,
      550,
    );
    expect(expected).toBeGreaterThan(0);
    expect(a.invoices[0]!.msmeInterest).toBe(expected);
    expect(a.msme).toEqual({
      udyamNumber: 'UDYAM-MH-26-0012345',
      interest: expected,
    });
    // And the reminder says so
    process.env.SMTP_URL = 'json';
    try {
      await as()
        .post(`/invoices/${inv[1]}/remind`, { email: 'a@kumar.example' })
        .expect(200);
      expect(app.get(MailService).capturedText.at(-1)).toContain(
        `under section 16 of the MSMED Act, 2006 to interest on payments made after the appointed day. On this invoice it comes to INR ${(expected / 100).toFixed(2)} so far.`,
      );
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('remembers when a customer was last chased, on WhatsApp or by email', async () => {
    await as('viewer').post(`/contacts/${kumar}/chased`).expect(403);
    const r = (
      await as()
        .post(`/contacts/${kumar}/chased`, { channel: 'whatsapp' })
        .expect(200)
    ).body as { lastChasedAt: string };
    const c = (await as().get(`/contacts/${kumar}`).expect(200)).body as {
      lastChasedAt: string;
    };
    expect(c.lastChasedAt).toBe(r.lastChasedAt);
    await as().post(`/contacts/${vendor}/chased`).expect(400);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, action: 'org.contact.chased' },
      }),
    ).toBe(1);
  });

  it('turns away made-up links, and stops when turned off', async () => {
    await visitor('x'.repeat(32)).expect(404);
    await visitor('short').expect(404);
    await as('viewer').delete(`/contacts/${kumar}/share`).expect(403);
    await as().delete(`/contacts/${kumar}/share`).expect(200);
    await visitor(token).expect(404);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org,
          action: { in: ['org.contact.share', 'org.contact.unshare'] },
        },
      }),
    ).toBe(2);
  });
});
