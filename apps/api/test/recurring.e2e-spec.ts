import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { fiscalYearOf, todayIn } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Schedule = {
  id: string;
  status: string;
  count: number;
  nextDate: string | null;
  lastError: string | null;
  invoices: {
    number: string | null;
    status: string;
    issueDate: string;
    total: number;
  }[];
};

/** Days from today, in the organisation's time zone, so the test holds on any day it runs */
const today = todayIn('Asia/Kolkata');
const day = (offset: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe('Recurring invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  const sched: Record<string, Schedule> = {};
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
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const schedule = (body: object) => ({
    name: 'Monthly retainer',
    contactId: contact.kumar,
    frequency: 'monthly',
    startDate: day(-40),
    lines: [
      {
        description: 'Retainer',
        quantity: 1,
        unitPrice: 1_000_000,
        accountId: acc.sales,
      },
    ],
    ...body,
  });
  const raise = async () =>
    (await as().post('/recurring-invoices/run').expect(200)).body as {
      raised: { scheduleId: string; date: string; issued: boolean }[];
      failed: { scheduleId: string; reason: string }[];
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
          name: `Recurring ${run}`,
          slug: `recurring-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          timeZone: 'Asia/Kolkata',
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
    // Financial years for every date the schedules reach
    for (const y of new Set([day(-70), day(40)].map((d) => fiscalYearOf(d, 4))))
      await as().post('/fiscal-years', { startYear: y }).expect(201);
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
          paymentTermsDays: 15,
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
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('sets up schedules for customers only, starting where they start', async () => {
    expect(
      (
        await as()
          .post('/recurring-invoices', schedule({ contactId: contact.sharma }))
          .expect(400)
      ).body.details.reason,
    ).toBe('not_customer');
    await as('auditor').post('/recurring-invoices', schedule({})).expect(403);
    // Every two weeks from 65 days ago, issuing each one
    sched.fortnightly = (
      await as()
        .post(
          '/recurring-invoices',
          schedule({
            name: 'Fortnightly support',
            frequency: 'weekly',
            interval: 2,
            startDate: day(-65),
            autoIssue: true,
          }),
        )
        .expect(201)
    ).body;
    expect(sched.fortnightly).toMatchObject({
      status: 'active',
      count: 0,
      nextDate: day(-65),
    });
    // Monthly from 40 days ago, twice only, as drafts
    sched.twice = (
      await as()
        .post('/recurring-invoices', schedule({ maxCount: 2 }))
        .expect(201)
    ).body;
  });

  it('shows what is coming, including what is overdue to raise', async () => {
    const up = (
      await as('auditor')
        .get('/recurring-invoices/upcoming?days=30')
        .expect(200)
    ).body as {
      scheduleId: string;
      date: string;
      total: number;
      overdue: boolean;
    }[];
    const fortnightly = up.filter(
      (u) => u.scheduleId === sched.fortnightly!.id,
    );
    // Days -65, -51, -37, -23, -9 are overdue; +5 and +19 fall within the month
    expect(fortnightly.map((u) => u.date)).toEqual(
      [-65, -51, -37, -23, -9, 5, 19].map(day),
    );
    expect(fortnightly.filter((u) => u.overdue)).toHaveLength(5);
    expect(fortnightly[0]!.total).toBe(1_000_000);
    expect(up.filter((u) => u.scheduleId === sched.twice!.id)).toHaveLength(2);
  });

  it('raises everything due, catching up, and never twice', async () => {
    const r = await raise();
    expect(r.failed).toEqual([]);
    expect(
      r.raised
        .filter((x) => x.scheduleId === sched.fortnightly!.id)
        .map((x) => [x.date, x.issued]),
    ).toEqual([-65, -51, -37, -23, -9].map((d) => [day(d), true]));
    expect(
      r.raised
        .filter((x) => x.scheduleId === sched.twice!.id)
        .map((x) => x.issued),
    ).toEqual([false, false]);
    expect((await raise()).raised).toEqual([]);

    const f = (
      await as().get(`/recurring-invoices/${sched.fortnightly!.id}`).expect(200)
    ).body as Schedule;
    expect(f).toMatchObject({
      status: 'active',
      count: 5,
      nextDate: day(5),
      lastError: null,
    });
    expect(
      f.invoices.every(
        (i) => i.status === 'issued' && i.number?.startsWith('INV/'),
      ),
    ).toBe(true);
    const t = (
      await as().get(`/recurring-invoices/${sched.twice!.id}`).expect(200)
    ).body as Schedule;
    expect(t).toMatchObject({ status: 'ended', count: 2, nextDate: null });
    expect(t.invoices.map((i) => i.status)).toEqual(['draft', 'draft']);

    // Each invoice knows its schedule, and is due on the customer's terms
    const id = (await prisma.invoice.findFirst({
      where: { organizationId: org, recurringInvoiceId: sched.fortnightly!.id },
      orderBy: { issueDate: 'asc' },
      select: { id: true },
    }))!.id;
    const inv = (await as().get(`/invoices/${id}`).expect(200)).body;
    expect(inv).toMatchObject({
      issueDate: day(-65),
      dueDate: day(-50),
      recurring: { id: sched.fortnightly!.id, name: 'Fortnightly support' },
    });
  });

  it('keeps a date it could not raise for the next run, with the reason', async () => {
    const s = (
      await as()
        .post(
          '/recurring-invoices',
          schedule({
            name: 'Quarterly audit',
            frequency: 'quarterly',
            startDate: day(-1),
            autoIssue: true,
          }),
        )
        .expect(201)
    ).body as Schedule;
    await as().post(`/contacts/${contact.kumar}/archive`).expect(200);
    const r = await raise();
    expect(r.failed.map((f) => f.scheduleId)).toEqual([s.id]);
    expect(
      (await as().get(`/recurring-invoices/${s.id}`).expect(200)).body,
    ).toMatchObject({
      count: 0,
      nextDate: day(-1),
      lastError: expect.stringMatching(/archived/i),
    });
    await as().post(`/contacts/${contact.kumar}/restore`).expect(200);
    expect((await raise()).raised.map((x) => x.scheduleId)).toEqual([s.id]);
    expect(
      (await as().get(`/recurring-invoices/${s.id}`).expect(200)).body,
    ).toMatchObject({ count: 1, lastError: null });
  });

  it('pauses and resumes, and only deletes a schedule that raised nothing', async () => {
    expect(
      (
        await as()
          .post(`/recurring-invoices/${sched.fortnightly!.id}/pause`)
          .expect(200)
      ).body.status,
    ).toBe('paused');
    expect(
      (await as().get('/recurring-invoices/upcoming').expect(200)).body.some(
        (u: { scheduleId: string }) => u.scheduleId === sched.fortnightly!.id,
      ),
    ).toBe(false);
    expect(
      (
        await as()
          .post(`/recurring-invoices/${sched.fortnightly!.id}/resume`)
          .expect(200)
      ).body.status,
    ).toBe('active');
    expect(
      (
        await as()
          .delete(`/recurring-invoices/${sched.fortnightly!.id}`)
          .expect(409)
      ).body.details.reason,
    ).toBe('has_invoices');
    const fresh = (
      await as()
        .post('/recurring-invoices', schedule({ startDate: day(30) }))
        .expect(201)
    ).body as Schedule;
    await as().delete(`/recurring-invoices/${fresh.id}`).expect(204);
    // Changing the template moves only what comes next
    const changed = (
      await as()
        .put(
          `/recurring-invoices/${sched.fortnightly!.id}`,
          schedule({
            name: 'Fortnightly support',
            frequency: 'weekly',
            interval: 2,
            startDate: day(-65),
            autoIssue: true,
            maxCount: 6,
          }),
        )
        .expect(200)
    ).body as Schedule;
    expect(changed).toMatchObject({
      count: 5,
      nextDate: day(5),
      status: 'active',
    });
    expect(
      (
        await as()
          .put(
            `/recurring-invoices/${sched.fortnightly!.id}`,
            schedule({ frequency: 'weekly', startDate: day(-60) }),
          )
          .expect(409)
      ).body.details.reason,
    ).toBe('has_invoices');
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: org,
          action: { startsWith: 'org.recurring.' },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.recurring.create',
        'org.recurring.raise',
        'org.recurring.pause',
        'org.recurring.resume',
        'org.recurring.update',
        'org.recurring.delete',
      ]),
    );
  });
});
