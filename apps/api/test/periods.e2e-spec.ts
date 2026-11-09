import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PeriodsService } from '../src/periods/periods.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Period = { id: string; number: number; startDate: string; endDate: string; status: string; canClose: boolean; canReopen: boolean; closeReason: string | null };
type Year = { id: string; name: string; startDate: string; endDate: string; periods: Period[] };

describe('Financial years and periods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let orgA = '';
  let orgB = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return { get: (p: string) => auth(http().get(`/api/v1${p}`)), post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body) };
  };
  const years = async (who = 'owner', org = orgA) => (await as(who, org).get('/fiscal-years').expect(200)).body as { next: number; previous: number | null; years: Year[] };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    // India-style year starting in April, and a calendar-year organisation
    orgA = (await prisma.organization.create({ data: { name: `Periods A ${run}`, slug: `periods-a-${run}`, fiscalYearStartMonth: 4 } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Periods B ${run}`, slug: `periods-b-${run}`, fiscalYearStartMonth: 1 } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['accountant', orgA, 'accountant'],
      ['bookkeeper', orgA, 'bookkeeper'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('creates a financial year from the organisation start month, split into 12 monthly periods', async () => {
    await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(201);
    const { years: list, next, previous } = await years();
    expect(list[0]).toMatchObject({ name: 'FY 2026–27', startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(list[0]!.periods.map((p) => [p.number, p.startDate, p.endDate])).toContainEqual([11, '2027-02-01', '2027-02-28']);
    expect(list[0]!.periods).toHaveLength(12);
    expect([next, previous]).toEqual([2027, 2025]);

    await as('ownerB', orgB).post('/fiscal-years', { startYear: 2028 }).expect(201);
    const b = (await years('ownerB', orgB)).years[0]!;
    expect(b).toMatchObject({ name: 'FY 2028', startDate: '2028-01-01', endDate: '2028-12-31' });
    expect(b.periods[1]).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29' }); // leap year
  });

  it('keeps years contiguous: next, previous, never gaps or duplicates', async () => {
    expect((await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(409)).body.details).toEqual({ reason: 'exists' });
    expect((await as('owner').post('/fiscal-years', { startYear: 2029 }).expect(400)).body.details).toEqual({ reason: 'not_contiguous' });
    await as('owner').post('/fiscal-years', { startYear: 2027 }).expect(201);
    await as('owner').post('/fiscal-years', { startYear: 2025 }).expect(201);
    expect((await years()).years.map((y) => y.name)).toEqual(['FY 2027–28', 'FY 2026–27', 'FY 2025–26']);
    const entry = await prisma.auditLog.findFirst({ where: { organizationId: orgA, action: 'org.fiscal_year.create' }, orderBy: { createdAt: 'asc' } });
    expect(entry?.after).toMatchObject({ name: 'FY 2026–27', startDate: '2026-04-01' });
  });

  it('locks the fiscal year start month in settings once years exist', async () => {
    const res = await as('owner').get('/organization').expect(200);
    expect(res.body.organization.locks.fiscalYearStartMonth).toBe(true);
    const patch = await http().patch('/api/v1/organization').set('Authorization', `Bearer ${users.owner!.token}`).set('X-Organization-Id', orgA).send({ fiscalYearStartMonth: 1 }).expect(409);
    expect(patch.body.details).toEqual({ reason: 'locked', field: 'fiscalYearStartMonth' });
  });

  it('closes periods in order, and reopens them in reverse, with reasons audited', async () => {
    const all = (await years()).years.flatMap((y) => y.periods).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const [first, second] = all as [Period, Period];
    expect(all.filter((p) => p.canClose).map((p) => p.id)).toEqual([first.id]);

    expect((await as('owner').post(`/fiscal-years/periods/${second.id}/close`).expect(409)).body.details).toEqual({ reason: 'earlier_open' });
    await as('accountant').post(`/fiscal-years/periods/${first.id}/close`, { reason: 'April books final' }).expect(204);
    await as('accountant').post(`/fiscal-years/periods/${second.id}/close`).expect(204);
    expect((await as('accountant').post(`/fiscal-years/periods/${first.id}/reopen`).expect(409)).body.details).toEqual({ reason: 'later_closed' });

    const now = (await years()).years.flatMap((y) => y.periods);
    expect(now.find((p) => p.id === first.id)).toMatchObject({ status: 'closed', closeReason: 'April books final', canReopen: false });
    expect(now.find((p) => p.id === second.id)).toMatchObject({ status: 'closed', canReopen: true });

    await as('owner').post(`/fiscal-years/periods/${second.id}/reopen`, { reason: 'Late supplier bill' }).expect(204);
    const reopened = await prisma.auditLog.findFirst({ where: { organizationId: orgA, action: 'org.period.reopen' } });
    expect(reopened?.after).toMatchObject({ reason: 'Late supplier bill', startDate: second.startDate });
  });

  it('tells journal entries whether a day is open, closed or outside every year', async () => {
    const status = (day: string) => prisma.$transaction((tx) => PeriodsService.dayStatus(tx, orgA, day));
    expect(await status('2025-04-15')).toBe('closed');
    expect(await status('2025-05-31')).toBe('open');
    expect(await status('2030-01-01')).toBe('no_period');
  });

  it('the database itself refuses overlapping years or periods', async () => {
    await expect(prisma.fiscalYear.create({ data: { organizationId: orgA, name: 'Overlap', startDate: new Date('2026-10-01'), endDate: new Date('2027-09-30') } })).rejects.toThrow(/fiscal_years_no_overlap/);
  });

  it('needs the right permission for each action, and never touches another organisation', async () => {
    const period = (await years()).years.flatMap((y) => y.periods).find((p) => p.canClose)!;
    expect((await as('bookkeeper').post(`/fiscal-years/periods/${period.id}/close`).expect(403)).body.details).toEqual({ missing: ['periods.close'] });
    await as('bookkeeper').get('/fiscal-years').expect(200);
    await as('ownerB', orgB).post(`/fiscal-years/periods/${period.id}/close`).expect(404);
  });
});
