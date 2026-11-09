import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Centre = {
  id: string;
  code: string;
  name: string;
  kind: string;
  archived: boolean;
};
type Entry = {
  id: string;
  lines: {
    account: { code: string };
    debit: number;
    credit: number;
    costCentre: { code: string } | null;
  }[];
};
type Pnl = {
  columns: { costCentre?: { code: string } | null }[];
  costCentre: unknown;
  netProfit: number[];
  sections: { section: string; total: number[] }[];
};

describe('Cost centres (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const cc: Record<string, string> = {};
  const contact: Record<string, string> = {};
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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const journal = async (
    date: string,
    lines: [string, number, number, string?][],
  ) => {
    const d = await as().post('/journals', {
      date,
      memo: 'Test',
      lines: lines.map(([a, debit, credit, c]) => ({
        accountId: acc[a],
        debit,
        credit,
        costCentreId: c ? cc[c] : null,
      })),
    });
    if (d.status !== 201) return d;
    return as().post(`/journals/${d.body.id}/post`);
  };
  const pnl = async (q: string) =>
    (
      await as('viewer')
        .get(`/reports/profit-and-loss?from=2026-04-01&to=2027-03-31${q}`)
        .expect(200)
    ).body as Pnl;

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
          name: `Centres ${run}`,
          slug: `centres-${run}`,
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
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
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
    contact.sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Office Supplies',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('adds departments and projects with unique codes', async () => {
    const pune = (
      await as()
        .post('/cost-centres', { code: 'pune', name: 'Pune branch' })
        .expect(201)
    ).body as Centre;
    expect(pune).toMatchObject({
      code: 'PUNE',
      kind: 'department',
      archived: false,
    });
    cc.pune = pune.id;
    cc.alpha = (
      (
        await as()
          .post('/cost-centres', {
            code: 'PRJ-ALPHA',
            name: 'Project Alpha',
            kind: 'project',
          })
          .expect(201)
      ).body as Centre
    ).id;
    cc.spare = (
      (
        await as()
          .post('/cost-centres', { code: 'SPARE', name: 'Spare' })
          .expect(201)
      ).body as Centre
    ).id;
    expect(
      (
        await as()
          .post('/cost-centres', { code: 'PUNE', name: 'Again' })
          .expect(409)
      ).body.details.reason,
    ).toBe('code_taken');
    await as('viewer')
      .post('/cost-centres', { code: 'X', name: 'X' })
      .expect(403);
    expect(
      (
        (await as('viewer').get('/cost-centres').expect(200)).body as Centre[]
      ).map((c) => c.code),
    ).toEqual(['PRJ-ALPHA', 'PUNE', 'SPARE']);
  });

  it('tags journal lines, and a reversal keeps the tags', async () => {
    await journal('2026-05-02', [
      ['bank', 50_000_00, 0],
      ['sales', 0, 50_000_00, 'pune'],
    ]).then((r) => expect(r.status).toBe(200));
    const r = await journal('2026-05-03', [
      ['rent', 10_000_00, 0, 'alpha'],
      ['bank', 0, 10_000_00],
    ]);
    const e = (await as().get(`/journals/${r.body.id}`).expect(200))
      .body as Entry;
    expect(e.lines.map((l) => l.costCentre?.code ?? null)).toEqual([
      'PRJ-ALPHA',
      null,
    ]);
    const rev = (
      await as().post(`/journals/${r.body.id}/reverse`, {}).expect(201)
    ).body as { id: string };
    const back = (await as().get(`/journals/${rev.id}`).expect(200))
      .body as Entry;
    expect(back.lines.find((l) => l.account.code === '5300')).toMatchObject({
      credit: 10_000_00,
      costCentre: { code: 'PRJ-ALPHA' },
    });
    expect(
      (
        await as()
          .post('/journals', {
            date: '2026-05-03',
            lines: [
              { accountId: acc.rent, debit: 1, costCentreId: randomUUID() },
              { accountId: acc.bank, credit: 1 },
            ],
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('cost_centre_not_found');
  });

  it('carries the tags from invoice and bill lines to what they post', async () => {
    const inv = (
      await as()
        .post('/invoices', {
          contactId: contact.kumar,
          issueDate: '2026-06-01',
          lines: [
            {
              description: 'Freight, Alpha',
              quantity: 1,
              unitPrice: 30_000_00,
              accountId: acc.sales,
              costCentreId: cc.alpha,
            },
          ],
        })
        .expect(201)
    ).body as { id: string; lines: { costCentre: { code: string } | null }[] };
    expect(inv.lines[0]!.costCentre).toMatchObject({ code: 'PRJ-ALPHA' });
    const issued = (await as().post(`/invoices/${inv.id}/issue`).expect(200))
      .body as { journalEntry: { id: string } };
    const ie = (
      await as().get(`/journals/${issued.journalEntry.id}`).expect(200)
    ).body as Entry;
    expect(
      ie.lines.find((l) => l.account.code === '4100')!.costCentre,
    ).toMatchObject({ code: 'PRJ-ALPHA' });
    expect(
      ie.lines.find((l) => l.account.code === '1300')!.costCentre,
    ).toBeNull();

    const bill = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          billDate: '2026-06-02',
          lines: [
            {
              description: 'Office rent, Pune',
              quantity: 1,
              unitPrice: 20_000_00,
              accountId: acc.rent,
              costCentreId: cc.pune,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    const recorded = (await as().post(`/bills/${bill.id}/record`).expect(200))
      .body as { journalEntry: { id: string } };
    const be = (
      await as().get(`/journals/${recorded.journalEntry.id}`).expect(200)
    ).body as Entry;
    expect(
      be.lines.find((l) => l.account.code === '5300')!.costCentre,
    ).toMatchObject({ code: 'PUNE' });
  });

  it('shows profit by cost centre, for one, and for the untagged lines', async () => {
    const by = await pnl('&compare=costCentres');
    expect(by.columns.map((c) => c.costCentre?.code ?? null)).toEqual([
      'PRJ-ALPHA',
      'PUNE',
      null,
    ]);
    // Alpha: 30,000 of freight, rent reversed; Pune: 50,000 of sales less 20,000 of rent
    expect(by.netProfit).toEqual([30_000_00, 30_000_00, 0]);
    const pune = await pnl(`&costCentreId=${cc.pune}`);
    expect(pune.costCentre).toMatchObject({ code: 'PUNE' });
    expect(pune.netProfit).toEqual([30_000_00]);
    expect((await pnl('&costCentreId=none')).netProfit).toEqual([0]);
    expect((await pnl('')).netProfit).toEqual([60_000_00]);
    const csv = (
      await as()
        .get(
          '/reports/profit-and-loss/export?from=2026-04-01&to=2027-03-31&compare=costCentres',
        )
        .expect(200)
    ).text;
    expect(csv.split('\r\n')[0]).toContain('PRJ-ALPHA Project Alpha');
  });

  it('archives a centre so new lines can’t use it, and only deletes unused ones', async () => {
    await as().post(`/cost-centres/${cc.alpha}/archive`).expect(200);
    const r = await journal('2026-07-01', [
      ['rent', 1_00, 0, 'alpha'],
      ['bank', 0, 1_00],
    ]);
    expect(r.status).toBe(400);
    expect(r.body.details.reason).toBe('cost_centre_archived');
    expect(
      ((await as().get('/cost-centres').expect(200)).body as Centre[]).map(
        (c) => c.code,
      ),
    ).toEqual(['PUNE', 'SPARE']);
    expect(
      (
        (await as().get('/cost-centres?archived=true').expect(200))
          .body as Centre[]
      ).find((c) => c.code === 'PRJ-ALPHA')!.archived,
    ).toBe(true);
    expect(
      (await as().delete(`/cost-centres/${cc.pune}`).expect(409)).body.details
        .reason,
    ).toBe('in_use');
    await as().delete(`/cost-centres/${cc.spare}`).expect(204);
    await as()
      .patch(`/cost-centres/${cc.pune}`, {
        code: 'PUNE',
        name: 'Pune office',
        kind: 'department',
      })
      .expect(200);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: org,
          action: { startsWith: 'org.cost_centre.' },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.cost_centre.create',
        'org.cost_centre.update',
        'org.cost_centre.archive',
        'org.cost_centre.delete',
      ]),
    );
  });
});
