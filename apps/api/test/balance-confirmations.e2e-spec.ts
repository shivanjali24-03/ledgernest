import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Row = {
  contact: { name: string };
  balance: number;
  status: string;
  theirBalance: number | null;
  note: string | null;
  respondedBy: string | null;
  sentTo: string | null;
  token: string;
};

describe('Balance confirmations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';

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
  const pub = (token: string) => `/api/v1/public/confirmations/${token}`;
  const rows = async (side = 'receivable') =>
    (
      await as()
        .get(`/balance-confirmations?asOf=2027-03-31&side=${side}`)
        .expect(200)
    ).body as Row[];
  const row = async (name: string, side = 'receivable') =>
    (await rows(side)).find((r) => r.contact.name === name)!;

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
          name: `Confirm ${run}`,
          legalName: `Confirm Traders ${run}`,
          slug: `confirm-${run}`,
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
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      [
        'freight',
        { code: '5100', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    for (const [key, body] of [
      [
        'kumar',
        {
          name: 'Kumar Logistics',
          legalName: 'Kumar Logistics Private Limited',
          email: 'accounts@kumar.example',
          isCustomer: true,
          isVendor: false,
        },
      ],
      [
        'bluewave',
        { name: 'Bluewave Clinics', isCustomer: true, isVendor: false },
      ],
      ['quiet', { name: 'Quiet Co', isCustomer: true, isVendor: false }],
      [
        'sharma',
        {
          name: 'Sharma Supplies',
          email: 'billing@sharma.example',
          isCustomer: false,
          isVendor: true,
        },
      ],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
    for (const [who, unitPrice, issueDate] of [
      ['kumar', 1_18_000_00, '2026-06-01'],
      ['bluewave', 50_000_00, '2026-07-01'],
    ] as const) {
      const d = (
        await as()
          .post('/invoices', {
            contactId: contact[who],
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
    }
    const b = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          vendorReference: 'SS-11',
          billDate: '2026-06-05',
          lines: [
            {
              description: 'Packing',
              quantity: 1,
              unitPrice: 30_000_00,
              accountId: acc.freight,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/bills/${b.id}/record`).expect(200);
  });

  afterAll(async () => {
    delete process.env.SMTP_URL;
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('asks every customer with a balance, emailing those with an address', async () => {
    process.env.SMTP_URL = 'json';
    await as('viewer')
      .post('/balance-confirmations', {
        asOf: '2027-03-31',
        side: 'receivable',
      })
      .expect(403);
    const r = (
      await as()
        .post('/balance-confirmations', {
          asOf: '2027-03-31',
          side: 'receivable',
        })
        .expect(200)
    ).body as {
      created: number;
      emailed: number;
      skipped: { name: string; reason: string }[];
    };
    expect(r).toEqual({
      created: 2,
      emailed: 1,
      skipped: [
        expect.objectContaining({
          name: 'Bluewave Clinics',
          reason: 'no_email',
        }),
      ],
    });
    expect(app.get(MailService).captured.at(-1)).toMatchObject({
      to: ['accounts@kumar.example'],
      subject: `Balance confirmation as on 2027-03-31: Confirm Traders ${run}`,
    });
    const list = (
      await as('viewer')
        .get('/balance-confirmations?asOf=2027-03-31&side=receivable')
        .expect(200)
    ).body as Row[];
    expect(
      list.map((x) => [x.contact.name, x.balance, x.status, x.sentTo]),
    ).toEqual([
      ['Bluewave Clinics', 50_000_00, 'pending', null],
      ['Kumar Logistics', 1_18_000_00, 'pending', 'accounts@kumar.example'],
    ]);
  });

  it('shows the party their balance and statement from the link, without signing in', async () => {
    const { token } = await row('Kumar Logistics');
    const v = await http().get(pub(token)).expect(200);
    expect(v.headers['cache-control']).toBe('private, no-store');
    expect(v.body).toMatchObject({
      organization: { name: `Confirm Traders ${run}` },
      party: { name: 'Kumar Logistics Private Limited' },
      side: 'receivable',
      asOf: '2027-03-31',
      currency: 'INR',
      balance: 1_18_000_00,
      status: 'pending',
    });
    const pdf = await http()
      .get(`${pub(token)}/statement`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await http()
      .get(pub('x'.repeat(32)))
      .expect(404);
  });

  it('takes one answer: agreed, or disputed with their figure and a note', async () => {
    const kumar = await row('Kumar Logistics');
    await http()
      .post(pub(kumar.token))
      .send({ response: 'dispute', name: 'Ravi Kumar' })
      .expect(400);
    const d = await http()
      .post(pub(kumar.token))
      .send({
        response: 'dispute',
        name: 'Ravi Kumar',
        theirBalance: 1_00_000_00,
        note: 'We paid ₹18,000 on 30 March by NEFT.',
      })
      .expect(200);
    expect(d.body).toMatchObject({
      status: 'disputed',
      theirBalance: 1_00_000_00,
    });
    expect(
      (
        await http()
          .post(pub(kumar.token))
          .send({ response: 'agree', name: 'Ravi Kumar' })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'answered' });
    const blue = await row('Bluewave Clinics');
    await http()
      .post(pub(blue.token))
      .send({ response: 'agree', name: 'Dr. Meera Iyer' })
      .expect(200);
    expect(
      (await rows()).map((x) => [
        x.contact.name,
        x.status,
        x.respondedBy,
        x.note,
      ]),
    ).toEqual([
      ['Bluewave Clinics', 'agreed', 'Dr. Meera Iyer', null],
      [
        'Kumar Logistics',
        'disputed',
        'Ravi Kumar',
        'We paid ₹18,000 on 30 March by NEFT.',
      ],
    ]);
  });

  it('reuses requests for the same day, never re-sends answered ones, and works for vendors', async () => {
    const before = await row('Kumar Logistics');
    const again = (
      await as()
        .post('/balance-confirmations', {
          asOf: '2027-03-31',
          side: 'receivable',
        })
        .expect(200)
    ).body as { emailed: number; skipped: { reason: string }[] };
    expect(again.emailed).toBe(0);
    expect(again.skipped.map((s) => s.reason)).toEqual([
      'answered',
      'answered',
    ]);
    expect((await row('Kumar Logistics')).token).toBe(before.token);
    const v = (
      await as()
        .post('/balance-confirmations', {
          asOf: '2027-03-31',
          side: 'payable',
          send: false,
        })
        .expect(200)
    ).body as { created: number; emailed: number };
    expect(v).toMatchObject({ created: 1, emailed: 0 });
    expect(await row('Sharma Supplies', 'payable')).toMatchObject({
      balance: 30_000_00,
      status: 'pending',
      sentTo: null,
    });
  });
});
