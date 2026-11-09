import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ScheduledReportsService } from '../src/scheduled-reports/scheduled-reports.service.js';
import { setupApp } from '../src/setup-app.js';

type Schedule = { id: string; nextRunAt: string; active: boolean };
type Delivery = {
  id: string;
  periodFrom: string;
  periodTo: string;
  fileName: string;
  emailedTo: string[];
  error: string | null;
};

describe('Scheduled reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
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
  const email = (who: string) => `${who}-${run}@test.ledgernest.local`;

  beforeAll(async () => {
    process.env.SMTP_URL = 'json';
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
          name: `Scheduled ${run}`,
          slug: `scheduled-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    const desk = await prisma.role.create({
      data: {
        organizationId: org,
        name: 'Sales desk',
        permissions: ['contacts.view'],
      },
    });
    for (const [key, role] of [
      ['owner', 'owner'],
      ['accountant', 'accountant'],
      ['viewer', 'viewer'],
      ['desk', null],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: email(key),
          name: `User ${key}`,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: {
          userId: u.id,
          organizationId: org,
          builtInRole: role,
          customRoleId: role ? null : desk.id,
        },
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
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    const d = await as()
      .post('/journals', {
        date: '2026-10-15',
        memo: 'Cash sale',
        lines: [
          { accountId: acc.bank, debit: 50_000_00 },
          { accountId: acc.sales, credit: 50_000_00 },
        ],
      })
      .expect(201);
    await as().post(`/journals/${d.body.id}/post`).expect(200);
  });

  afterAll(async () => {
    delete process.env.SMTP_URL;
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let monthly = '';

  it('is set up for members who can see reports, and runs next on its day', async () => {
    const body = {
      name: 'Monthly P&L',
      report: 'profit_and_loss',
      frequency: 'monthly',
      day: 1,
      format: 'xlsx',
      recipients: [users.owner!.id, users.accountant!.id],
    };
    await as('viewer').post('/scheduled-reports', body).expect(403);
    expect(
      (
        await as()
          .post('/scheduled-reports', { ...body, recipients: [users.desk!.id] })
          .expect(400)
      ).body.details.reason,
    ).toBe('recipient_invalid');
    await as()
      .post('/scheduled-reports', { ...body, frequency: 'weekly', day: 9 })
      .expect(400);
    const s = (await as().post('/scheduled-reports', body).expect(201))
      .body as Schedule;
    monthly = s.id;
    expect(new Date(s.nextRunAt).getUTCDate()).toBe(1);
    expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(
      (
        (await as('viewer').get('/scheduled-reports').expect(200))
          .body as Schedule[]
      ).length,
    ).toBe(1);
  });

  it('runs now for the month just ended: the file is kept and emailed', async () => {
    const d = (await as().post(`/scheduled-reports/${monthly}/run`).expect(200))
      .body as Delivery;
    const now = new Date();
    const first = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    )
      .toISOString()
      .slice(0, 10);
    expect(d.periodFrom.slice(0, 10)).toBe(first);
    expect(d.fileName).toMatch(
      /^profit-and-loss-\d{4}-\d{2}-01-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(d.emailedTo.sort()).toEqual(
      [email('accountant'), email('owner')].sort(),
    );
    const mail = app.get(MailService).captured.at(-1)!;
    expect(mail.subject).toMatch(
      /^Monthly P&L: Profit and loss .* · Scheduled /,
    );
    expect(mail.attachments).toEqual([d.fileName]);
    const file = await as('viewer')
      .get(`/scheduled-reports/deliveries/${d.id}/file`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(
      (
        (await as().get(`/scheduled-reports/${monthly}/deliveries`).expect(200))
          .body as Delivery[]
      ).length,
    ).toBe(1);
  });

  it('is picked up when due, once, and skipped while paused', async () => {
    const s = (
      await as()
        .post('/scheduled-reports', {
          name: 'Weekly balance sheet',
          report: 'balance_sheet',
          frequency: 'weekly',
          day: 1,
          format: 'csv',
          recipients: [users.viewer!.id],
        })
        .expect(201)
    ).body as Schedule;
    await prisma.scheduledReport.update({
      where: { id: s.id },
      data: { nextRunAt: new Date('2026-11-16T04:00:00Z') },
    });
    const svc = app.get(ScheduledReportsService);
    await svc.runDue(new Date('2026-11-16T05:00:00Z'));
    await svc.runDue(new Date('2026-11-16T05:30:00Z'));
    const list = (
      await as().get(`/scheduled-reports/${s.id}/deliveries`).expect(200)
    ).body as Delivery[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      fileName: 'balance-sheet-2026-11-15.csv',
      emailedTo: [email('viewer')],
    });
    expect(
      (
        await prisma.scheduledReport.findUniqueOrThrow({ where: { id: s.id } })
      ).nextRunAt.toISOString(),
    ).toBe('2026-11-23T04:00:00.000Z');
    await as()
      .patch(`/scheduled-reports/${s.id}`, { active: false })
      .expect(200);
    await prisma.scheduledReport.update({
      where: { id: s.id },
      data: { nextRunAt: new Date('2026-11-23T04:00:00Z') },
    });
    await svc.runDue(new Date('2026-11-23T05:00:00Z'));
    expect(
      (
        (await as().get(`/scheduled-reports/${s.id}/deliveries`).expect(200))
          .body as Delivery[]
      ).length,
    ).toBe(1);
  });

  it('keeps each schedule’s latest runs only', async () => {
    process.env.REPORT_RUNS_KEPT = '2';
    try {
      for (let n = 0; n < 3; n++)
        await as().post(`/scheduled-reports/${monthly}/run`).expect(200);
      expect(
        await prisma.reportDelivery.count({
          where: { organizationId: org, scheduleId: monthly },
        }),
      ).toBe(2);
    } finally {
      delete process.env.REPORT_RUNS_KEPT;
    }
  });

  it('can be removed, and is audited', async () => {
    await as().delete(`/scheduled-reports/${monthly}`).expect(204);
    expect(
      await prisma.reportDelivery.count({
        where: { organizationId: org, scheduleId: monthly },
      }),
    ).toBe(0);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: org,
          action: { startsWith: 'org.scheduled_report.' },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.scheduled_report.create',
        'org.scheduled_report.update',
        'org.scheduled_report.delete',
      ]),
    );
  });
});
