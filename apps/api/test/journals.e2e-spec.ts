import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Entry = { id: string; number: string | null; status: string; date: string; totals: { debit: number; credit: number; difference: number }; lines: { accountId: string; debit: number; credit: number }[]; reversalOf: { number: string } | null; reversedBy: { number: string } | null; attachments: { id: string }[] };

describe('Journal entries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let orgA = '';
  let orgB = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      del: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const draft = (lines: [string, number, number][], date = '2026-05-10', memo = 'Office rent for May') => ({ date, memo, lines: lines.map(([a, debit, credit]) => ({ accountId: acc[a], debit, credit })) });
  const create = async (body: object, who = 'accountant') => (await as(who).post('/journals', body).expect(201)).body as Entry;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    orgA = (await prisma.organization.create({ data: { name: `Journals A ${run}`, slug: `journals-a-${run}`, fiscalYearStartMonth: 4 } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Journals B ${run}`, slug: `journals-b-${run}` } })).id;
    await prisma.$transaction((tx) => AccountsService.createSystemAccounts(tx, orgA, 'en-IN'));
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['accountant', orgA, 'accountant'],
      ['bookkeeper', orgA, 'bookkeeper'],
      ['viewer', orgA, 'viewer'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    for (const [key, code, type, subtype] of [
      ['bank', '1100', 'asset', 'bank'],
      ['rent', '5300', 'expense', 'operating_expense'],
      ['sales', '4000', 'income', 'operating_income'],
      ['old', '5999', 'expense', 'other_expense'],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: orgA, code, name: `${key} ${run}`, type, subtype } })).id;
    }
    await prisma.account.update({ where: { id: acc.old }, data: { archivedAt: new Date() } });
    acc.foreign = (await prisma.account.create({ data: { organizationId: orgB, code: '1100', name: `B bank ${run}`, type: 'asset', subtype: 'bank' } })).id;
    await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('saves drafts, even unbalanced ones, and posts them with gap-free numbers', async () => {
    const d = await create(draft([['rent', 2500000, 0], ['bank', 0, 2000000]]));
    expect(d).toMatchObject({ status: 'draft', number: null, totals: { debit: 2500000, credit: 2000000, difference: 500000 } });

    const unbalanced = await as('accountant').post(`/journals/${d.id}/post`).expect(400);
    expect(unbalanced.body.details).toMatchObject({ reason: 'unbalanced', difference: 500000 });

    await as('accountant').patch(`/journals/${d.id}`, draft([['rent', 2500000, 0], ['bank', 0, 2500000]])).expect(200);
    const posted = (await as('accountant').post(`/journals/${d.id}/post`).expect(200)).body as Entry;
    expect(posted).toMatchObject({ status: 'posted', number: 'JV/2026-27/0001' });

    const second = await create(draft([['bank', 100000, 0], ['sales', 0, 100000]], '2026-06-01', 'Cash sale'));
    expect((await as('accountant').post(`/journals/${second.id}/post`).expect(200)).body.number).toBe('JV/2026-27/0002');
    const entry = await prisma.auditLog.findFirst({ where: { organizationId: orgA, action: 'org.journal.post', entityId: d.id } });
    expect(entry?.after).toMatchObject({ number: 'JV/2026-27/0001', debit: 2500000, credit: 2500000 });
  });

  it('never changes or deletes a posted entry', async () => {
    const posted = (await as('accountant').get('/journals?status=posted').expect(200)).body.items[0] as Entry;
    expect((await as('accountant').patch(`/journals/${posted.id}`, draft([['rent', 1, 0], ['bank', 0, 1]])).expect(409)).body.details).toEqual({ reason: 'posted' });
    expect((await as('accountant').del(`/journals/${posted.id}`).expect(409)).body.details).toEqual({ reason: 'posted' });
    // The database refuses as well, whatever the application does
    await expect(prisma.journalEntry.update({ where: { id: posted.id }, data: { memo: 'rewritten' } })).rejects.toThrow(/can't be changed/);
    await expect(prisma.journalEntry.delete({ where: { id: posted.id } })).rejects.toThrow(/can't be deleted/);
    await expect(prisma.journalLine.updateMany({ where: { entryId: posted.id }, data: { debit: 1n } })).rejects.toThrow(/can't change/);
  });

  it('corrects mistakes with a reversal: the exact opposite, linked both ways, once', async () => {
    const original = (await as('accountant').get('/journals?status=posted').expect(200)).body.items.find((e: Entry) => e.number === 'JV/2026-27/0002') as Entry;
    const r = (await as('accountant').post(`/journals/${original.id}/reverse`, { date: '2026-06-02' }).expect(201)).body as Entry;
    expect(r).toMatchObject({ status: 'posted', number: 'JV/2026-27/0003', date: '2026-06-02', reversalOf: { number: 'JV/2026-27/0002' } });
    expect(r.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [acc.bank, 0, 100000],
      [acc.sales, 100000, 0],
    ]);
    expect((await as('accountant').get(`/journals/${original.id}`).expect(200)).body.reversedBy).toMatchObject({ number: 'JV/2026-27/0003' });
    expect((await as('accountant').post(`/journals/${original.id}/reverse`).expect(409)).body.details).toEqual({ reason: 'already_reversed' });
    expect((await as('accountant').post(`/journals/${r.id}/reverse`).expect(409)).body.details).toEqual({ reason: 'is_reversal' });
  });

  it('posts only into open months of an existing financial year', async () => {
    const months = (await as('owner').get('/fiscal-years').expect(200)).body.years[0].periods;
    await as('owner').post(`/fiscal-years/periods/${months[0].id}/close`).expect(204); // April 2026
    const april = await create(draft([['rent', 500, 0], ['bank', 0, 500]], '2026-04-20'));
    expect((await as('accountant').post(`/journals/${april.id}/post`).expect(409)).body.details).toEqual({ reason: 'period_closed' });
    const noYear = await create(draft([['rent', 500, 0], ['bank', 0, 500]], '2031-01-01'));
    expect((await as('accountant').post(`/journals/${noYear.id}/post`).expect(409)).body.details).toEqual({ reason: 'no_period' });
    // Even writing straight to the database can't post into a closed month
    await expect(prisma.journalEntry.update({ where: { id: april.id }, data: { status: 'posted', number: 99, fiscalYearId: (await prisma.fiscalYear.findFirstOrThrow({ where: { organizationId: orgA } })).id, postedAt: new Date() } })).rejects.toThrow(/open period/);
  });

  it('refuses archived accounts, other organisations’ accounts, and lines that are both or neither', async () => {
    expect((await as('accountant').post('/journals', draft([['old', 500, 0], ['bank', 0, 500]])).expect(400)).body.details).toEqual({ reason: 'account_archived' });
    const foreign = await as('accountant').post('/journals', { date: '2026-05-01', lines: [{ accountId: acc.foreign, debit: 500 }, { accountId: acc.bank, credit: 500 }] }).expect(400);
    expect(foreign.body.details).toEqual({ reason: 'account_not_found' });
    await as('accountant').post('/journals', { date: '2026-05-01', lines: [{ accountId: acc.bank, debit: 500, credit: 500 }] }).expect(400);
    await as('accountant').post('/journals', { date: '2026-02-30', lines: [] }).expect(400);
  });

  it('locks accounts with entries and the base currency once anything is posted', async () => {
    expect((await as('owner').del(`/accounts/${acc.rent}`).expect(409)).body.details).toEqual({ reason: 'has_entries' });
    expect((await as('owner').patch(`/accounts/${acc.rent}`, { type: 'asset', subtype: 'current_asset' }).expect(409)).body.details).toEqual({ reason: 'has_entries' });
    const settings = await as('owner').get('/organization').expect(200);
    expect(settings.body.organization.locks.baseCurrency).toBe(true);
    expect((await as('owner').patch('/organization', { baseCurrency: 'USD' }).expect(409)).body.details).toEqual({ reason: 'locked', field: 'baseCurrency' });
  });

  it('attaches documents checked by their bytes, and keeps those of posted entries', async () => {
    const pdf = Buffer.from('%PDF-1.7\n% receipt\n');
    const d = await create(draft([['rent', 900, 0], ['bank', 0, 900]]));
    const withFile = (await as('bookkeeper').post(`/journals/${d.id}/attachments`, { fileName: 'receipt.pdf', type: 'application/pdf', data: pdf.toString('base64') }).expect(201)).body as Entry;
    const file = await as('accountant').get(`/journals/${d.id}/attachments/${withFile.attachments[0]!.id}`).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('receipt.pdf');
    expect(Buffer.compare(file.body as Buffer, pdf)).toBe(0);

    const fake = await as('bookkeeper').post(`/journals/${d.id}/attachments`, { fileName: 'x.pdf', type: 'application/pdf', data: Buffer.from('<html>').toString('base64') }).expect(400);
    expect(fake.body.details).toEqual({ reason: 'type_mismatch' });
    // A 1.5 MB scan fits, past the usual 100 KB request limit
    await as('bookkeeper').post(`/journals/${d.id}/attachments`, { fileName: 'scan.pdf', type: 'application/pdf', data: Buffer.concat([pdf, Buffer.alloc(1_500_000)]).toString('base64') }).expect(201);

    await as('accountant').post(`/journals/${d.id}/post`).expect(200);
    expect((await as('accountant').del(`/journals/${d.id}/attachments/${withFile.attachments[0]!.id}`).expect(409)).body.details).toEqual({ reason: 'posted' });
  });

  it('gives each role only its own powers, and isolates organisations', async () => {
    const d = await create(draft([['rent', 700, 0], ['bank', 0, 700]]), 'bookkeeper');
    expect((await as('bookkeeper').post(`/journals/${d.id}/post`).expect(403)).body.details).toEqual({ missing: ['journals.post'] });
    expect((await as('viewer').post('/journals', draft([['rent', 1, 0], ['bank', 0, 1]])).expect(403)).body.details).toEqual({ missing: ['journals.create'] });
    await as('viewer').get('/journals').expect(403);
    await as('ownerB', orgB).get(`/journals/${d.id}`).expect(404);
    expect((await as('ownerB', orgB).get('/journals').expect(200)).body.total).toBe(0);
  });

  it('lists entries newest first, with filters', async () => {
    const all = (await as('accountant').get('/journals?pageSize=100').expect(200)).body;
    const dates: string[] = all.items.map((e: Entry) => e.date);
    expect(dates).toEqual(dates.toSorted((a, b) => b.localeCompare(a)));
    const sales = (await as('accountant').get(`/journals?accountId=${acc.sales}`).expect(200)).body;
    expect(sales.items).toHaveLength(2); // the sale and its reversal
    expect((await as('accountant').get('/journals?search=cash%20sale').expect(200)).body.items.length).toBeGreaterThan(0);
    const changed = await as('accountant').get('/organization/audit?group=journals&limit=100').expect(200);
    expect(new Set(changed.body.items.map((i: { action: string }) => i.action))).toEqual(new Set(['org.journal.create', 'org.journal.update', 'org.journal.post', 'org.journal.reverse', 'org.journal.attach']));
  });
});
