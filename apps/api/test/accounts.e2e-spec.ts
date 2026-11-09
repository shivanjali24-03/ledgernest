import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Account = { id: string; code: string; name: string; type: string; parentId: string | null; childCount: number; system: boolean; archived: boolean; normalSide: string };

describe('Chart of accounts (e2e)', () => {
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
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      del: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const create = async (body: object, who = 'owner', org = orgA) => (await as(who, org).post('/accounts', body).expect(201)).body as Account;
  const list = async (q = '') => (await as('owner').get(`/accounts${q}`).expect(200)).body as Account[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    for (const [k, slug] of [
      ['A', 'a'],
      ['B', 'b'],
    ] as const) {
      const org = await prisma.organization.create({ data: { name: `Accounts ${k} ${run}`, slug: `accounts-${slug}-${run}`, locale: k === 'A' ? 'hi-IN' : 'en-IN' } });
      await prisma.$transaction((tx) => AccountsService.createSystemAccounts(tx, org.id, org.locale));
      if (k === 'A') orgA = org.id;
      else orgB = org.id;
    }
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['viewer', orgA, 'viewer'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
  });

  afterAll(async () => {
    // Deleting an organisation removes its whole account tree in one go (the tree's key is checked at statement end)
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    expect(await prisma.account.count({ where: { organizationId: { in: [orgA, orgB] } } })).toBe(0);
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('starts with system accounts named in the organisation language', async () => {
    const accounts = await list();
    expect(accounts.map((a) => [a.code, a.name, a.system])).toEqual([
      ['3900', 'प्रतिधारित आय', true],
      ['3990', 'प्रारंभिक शेष पूंजी', true],
    ]);
  });

  it('creates accounts and sub-accounts, ordered by code like an accountant reads them', async () => {
    const bank = await create({ code: '1100', name: 'Bank accounts', type: 'asset', subtype: 'bank' });
    await create({ code: '1100.10', name: 'HDFC current', type: 'asset', subtype: 'bank', parentId: bank.id });
    await create({ code: '1100.2', name: 'SBI savings', type: 'asset', subtype: 'bank', parentId: bank.id });
    await create({ code: '200', name: 'Petty cash', type: 'asset', subtype: 'cash' });

    const accounts = await list();
    expect(accounts.map((a) => a.code)).toEqual(['200', '1100', '1100.2', '1100.10', '3900', '3990']);
    expect(accounts.find((a) => a.code === '1100')).toMatchObject({ childCount: 2, normalSide: 'debit', system: false });
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgA, action: 'org.account.create', entityId: bank.id } });
    expect(audit?.after).toMatchObject({ code: '1100', name: 'Bank accounts', type: 'asset' });
  });

  it('keeps codes and names unique (names ignoring case)', async () => {
    const taken = await as('owner').post('/accounts', { code: '1100', name: 'Another', type: 'asset', subtype: 'bank' }).expect(409);
    expect(taken.body.details).toEqual({ reason: 'code_taken' });
    const name = await as('owner').post('/accounts', { code: '1200', name: 'PETTY CASH', type: 'asset', subtype: 'cash' }).expect(409);
    expect(name.body.details).toEqual({ reason: 'name_taken' });
  });

  it("refuses a sub-account of another type, a fifth level, and a loop", async () => {
    const bank = (await list()).find((a) => a.code === '1100')!;
    const wrongType = await as('owner').post('/accounts', { code: '4000', name: 'Sales', type: 'income', subtype: 'operating_income', parentId: bank.id }).expect(400);
    expect(wrongType.body.details).toEqual({ reason: 'parent_type' });

    const hdfc = (await list()).find((a) => a.code === '1100.10')!;
    const l3 = await create({ code: '1100.10.1', name: 'HDFC Pune', type: 'asset', subtype: 'bank', parentId: hdfc.id });
    const l4 = await create({ code: '1100.10.1.1', name: 'HDFC Pune escrow', type: 'asset', subtype: 'bank', parentId: l3.id });
    const deep = await as('owner').post('/accounts', { code: '1100.10.1.1A', name: 'Too deep', type: 'asset', subtype: 'bank', parentId: l4.id }).expect(400);
    expect(deep.body.details).toMatchObject({ reason: 'too_deep', max: 4 });

    const loop = await as('owner').patch(`/accounts/${bank.id}`, { parentId: l4.id }).expect(400);
    expect(loop.body.details).toEqual({ reason: 'cycle' });
    // l3 carries l4 beneath it: moving that 2-level subtree under a level-3 account would make 5 levels
    const sbi = (await list()).find((a) => a.code === '1100.2')!;
    const sbiBranch = await create({ code: '1100.2.1', name: 'SBI Nashik', type: 'asset', subtype: 'bank', parentId: sbi.id });
    const tooDeepMove = await as('owner').patch(`/accounts/${l3.id}`, { parentId: sbiBranch.id }).expect(400);
    expect(tooDeepMove.body.details).toMatchObject({ reason: 'too_deep' });
    // Under a level-2 account it fits (2 + 2 = 4 levels)
    expect((await as('owner').patch(`/accounts/${l3.id}`, { parentId: sbi.id }).expect(200)).body.parentId).toBe(sbi.id);
  });

  it('changes type only without sub-accounts, and only to a fitting sub-type', async () => {
    const bank = (await list()).find((a) => a.code === '1100')!;
    expect((await as('owner').patch(`/accounts/${bank.id}`, { type: 'liability', subtype: 'credit_card' }).expect(409)).body.details).toEqual({ reason: 'has_children' });
    const cash = (await list()).find((a) => a.code === '200')!;
    expect((await as('owner').patch(`/accounts/${cash.id}`, { type: 'expense' }).expect(400)).body.details).toEqual({ reason: 'subtype' });
    const moved = await as('owner').patch(`/accounts/${cash.id}`, { type: 'expense', subtype: 'operating_expense', name: 'Office cash spend' }).expect(200);
    expect(moved.body).toMatchObject({ type: 'expense', normalSide: 'debit', name: 'Office cash spend' });
    const entry = await prisma.auditLog.findFirst({ where: { organizationId: orgA, action: 'org.account.update', entityId: cash.id } });
    expect(entry).toMatchObject({ before: { type: 'asset', subtype: 'cash', name: 'Petty cash' }, after: { type: 'expense', subtype: 'operating_expense', name: 'Office cash spend' } });
  });

  it('lets system accounts be renamed but never removed or re-typed', async () => {
    const retained = (await list()).find((a) => a.code === '3900')!;
    await as('owner').patch(`/accounts/${retained.id}`, { name: 'Retained earnings' }).expect(200);
    expect((await as('owner').patch(`/accounts/${retained.id}`, { subtype: 'owner_equity' }).expect(400)).body.details).toEqual({ reason: 'system' });
    expect((await as('owner').post(`/accounts/${retained.id}/archive`).expect(400)).body.details).toEqual({ reason: 'system' });
    expect((await as('owner').del(`/accounts/${retained.id}`).expect(400)).body.details).toEqual({ reason: 'system' });
  });

  it('archives bottom-up, hides archived accounts unless asked, and restores top-down', async () => {
    const parent = await create({ code: '6000', name: 'Travel', type: 'expense', subtype: 'operating_expense' });
    const child = await create({ code: '6010', name: 'Flights', type: 'expense', subtype: 'operating_expense', parentId: parent.id });

    expect((await as('owner').post(`/accounts/${parent.id}/archive`).expect(409)).body.details).toEqual({ reason: 'has_active_children' });
    await as('owner').post(`/accounts/${child.id}/archive`).expect(200);
    await as('owner').post(`/accounts/${parent.id}/archive`).expect(200);
    expect((await list()).some((a) => a.code === '6000')).toBe(false);
    expect((await list('?includeArchived=true')).find((a) => a.code === '6000')).toMatchObject({ archived: true });

    expect((await as('owner').post(`/accounts/${child.id}/restore`).expect(409)).body.details).toEqual({ reason: 'parent_archived' });
    await as('owner').post(`/accounts/${parent.id}/restore`).expect(200);
    await as('owner').post(`/accounts/${child.id}/restore`).expect(200);
    const archivedParent = await as('owner').post('/accounts', { code: '6100', name: 'Under archived', type: 'expense', subtype: 'operating_expense', parentId: parent.id }).expect(201);
    expect(archivedParent.body.parentId).toBe(parent.id);
  });

  it('deletes only unused accounts without sub-accounts', async () => {
    const travel = (await list()).find((a) => a.code === '6000')!;
    expect((await as('owner').del(`/accounts/${travel.id}`).expect(409)).body.details).toEqual({ reason: 'has_children' });
    const flights = (await list()).find((a) => a.code === '6010')!;
    await as('owner').del(`/accounts/${flights.id}`).expect(204);
    expect(await prisma.auditLog.count({ where: { organizationId: orgA, action: 'org.account.delete', entityId: flights.id } })).toBe(1);
  });

  it('Viewers read the chart but cannot change it; other organisations see nothing', async () => {
    expect((await as('viewer').get('/accounts').expect(200)).body.length).toBeGreaterThan(2);
    expect((await as('viewer').post('/accounts', { code: '7000', name: 'X', type: 'expense', subtype: 'other_expense' }).expect(403)).body.details).toEqual({ missing: ['accounts.manage'] });

    const bank = (await list()).find((a) => a.code === '1100')!;
    expect((await as('ownerB', orgB).get('/accounts').expect(200)).body.map((a: Account) => a.code)).toEqual(['3900', '3990']);
    await as('ownerB', orgB).patch(`/accounts/${bank.id}`, { name: 'Stolen' }).expect(404);
    await as('ownerB', orgB).del(`/accounts/${bank.id}`).expect(404);
    const foreignParent = await as('ownerB', orgB).post('/accounts', { code: '1100.9', name: 'Sneaky', type: 'asset', subtype: 'bank', parentId: bank.id }).expect(400);
    expect(foreignParent.body.details).toEqual({ reason: 'parent_not_found' });
  });

  it('the database itself refuses a parent from another organisation or of another type', async () => {
    const bank = (await list()).find((a) => a.code === '1100')!;
    await expect(prisma.account.create({ data: { organizationId: orgB, code: 'X1', name: `x1-${run}`, type: 'asset', subtype: 'bank', parentId: bank.id } })).rejects.toThrow();
    await expect(prisma.account.create({ data: { organizationId: orgA, code: 'X2', name: `x2-${run}`, type: 'income', subtype: 'other_income', parentId: bank.id } })).rejects.toThrow(/same type as its parent/);
    await expect(prisma.account.create({ data: { organizationId: orgA, code: 'bad code', name: `x3-${run}`, type: 'asset', subtype: 'bank' } })).rejects.toThrow(/accounts_code_check/);
  });

  it('two people creating the same code at the same moment get one account, not an error', async () => {
    const body = { code: '8000', name: 'Interest income', type: 'income', subtype: 'other_income' };
    const results = await Promise.all([as('owner').post('/accounts', body), as('owner').post('/accounts', { ...body, name: 'Interest earned' })]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await prisma.account.count({ where: { organizationId: orgA, code: '8000' } })).toBe(1);
  });

  describe('industry templates', () => {
    it('previews a template in the organisation language', async () => {
      const res = await as('viewer').get('/accounts/templates/retail').expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(25);
      // Parents come before their sub-accounts
      const seen = new Set<string>();
      for (const a of res.body as { code: string; parent?: string; name: string }[]) {
        if (a.parent) expect(seen.has(a.parent)).toBe(true);
        seen.add(a.code);
      }
      expect(res.body.some((a: { name: string }) => /[\u0900-\u097F]/.test(a.name))).toBe(true); // Hindi, the organisation's language
      await as('viewer').get('/accounts/templates/spaceships').expect(404);
    });

    it('applies only to an empty chart, and only with accounts.manage', async () => {
      await as('viewer').post('/accounts/templates/retail/apply').expect(403);
      expect((await as('owner').post('/accounts/templates/retail/apply').expect(409)).body.details).toEqual({ reason: 'chart_not_empty' });

      const res = await as('ownerB', orgB).post('/accounts/templates/restaurant/apply').expect(201);
      const accounts = (await as('ownerB', orgB).get('/accounts').expect(200)).body as Account[];
      expect(res.body.created).toBe(accounts.length - 2); // plus the two system accounts
      expect(accounts.filter((a) => a.parentId).every((a) => accounts.find((p) => p.id === a.parentId)?.type === a.type)).toBe(true);
      const entry = await prisma.auditLog.findFirst({ where: { organizationId: orgB, action: 'org.account.template_apply' } });
      expect(entry?.after).toMatchObject({ industry: 'restaurant', accounts: res.body.created });
      // A second time is refused: the chart isn't empty any more
      await as('ownerB', orgB).post('/accounts/templates/restaurant/apply').expect(409);
    });
  });

  it('account changes have their own audit filter', async () => {
    const res = await as('owner').get('/organization/audit?group=accounts&limit=100').expect(200);
    const actions = new Set(res.body.items.map((i: { action: string }) => i.action));
    expect([...actions].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['org.account.archive', 'org.account.create', 'org.account.delete', 'org.account.restore', 'org.account.update']);
    const b = await as('ownerB', orgB).get('/organization/audit?group=accounts').expect(200);
    expect(b.body.items.map((i: { action: string }) => i.action)).toContain('org.account.template_apply');
  });
});
