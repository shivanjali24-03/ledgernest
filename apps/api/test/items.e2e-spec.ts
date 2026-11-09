import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Products and services (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let orgA = '';
  let orgB = '';
  let gst18 = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `Items A ${run}`, slug: `items-a-${run}`, country: 'IN', region: 'Maharashtra' } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Items B ${run}`, slug: `items-b-${run}` } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['auditor', orgA, 'auditor'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    for (const [key, code, type, subtype] of [
      ['services', '4100', 'income', 'operating_income'],
      ['hosting', '5100', 'expense', 'cost_of_sales'],
      ['computers', '1710', 'asset', 'fixed_asset'],
      ['bank', '1100', 'asset', 'bank'],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: orgA, code, name: `${key} ${run}`, type, subtype } })).id;
    }
    const setup = (await as('owner').post('/taxes/gst-setup').expect(200)).body as { groups: { id: string; name: string }[] };
    gst18 = setup.groups.find((g) => g.name === 'GST 18%')!.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  let dev = '';

  it('adds a service with its price, SAC code, tax group and income account', async () => {
    const i = (await as('owner').post('/items', { name: 'Software development', kind: 'service', sku: 'dev-hr', unit: 'hrs', salePrice: 250_000, hsnSac: '998314', taxGroupId: gst18, incomeAccountId: acc.services }).expect(201)).body;
    dev = i.id;
    expect(i).toMatchObject({ sku: 'DEV-HR', salePrice: 250_000, purchasePrice: null, taxGroup: { name: 'GST 18%', total: '18%' }, incomeAccount: { code: '4100' }, archived: false });
  });

  it('refuses duplicate names and SKUs, and accounts of the wrong kind', async () => {
    const reason = async (body: object, status: number) => (await as('owner').post('/items', { name: `Item ${randomUUID().slice(0, 4)}`, ...body }).expect(status)).body.details?.reason;
    expect(await reason({ name: 'software DEVELOPMENT' }, 409)).toBe('name_taken');
    expect(await reason({ sku: 'DEV-HR' }, 409)).toBe('sku_taken');
    expect(await reason({ incomeAccountId: acc.bank }, 400)).toBe('income_account_type');
    expect(await reason({ expenseAccountId: acc.services }, 400)).toBe('expense_account_type');
    await as('owner').post('/items', { name: 'Bad code', hsnSac: '12345' }).expect(400);
    // Purchases may go to an asset, e.g. computers
    const laptop = (await as('owner').post('/items', { name: 'Laptop', kind: 'goods', hsnSac: '84713010', purchasePrice: 7_200_000, expenseAccountId: acc.computers }).expect(201)).body;
    expect(laptop.expenseAccount.code).toBe('1710');
  });

  it('updates only what changes, lists and searches', async () => {
    await as('owner').patch(`/items/${dev}`, { salePrice: 275_000 }).expect(200);
    await as('owner').patch(`/items/${dev}`, { incomeAccountId: acc.hosting }).expect(400);
    const list = (await as('auditor').get('/items').expect(200)).body as { name: string }[];
    expect(list.map((i) => i.name)).toEqual(['Laptop', 'Software development']);
    expect((await as('auditor').get('/items?kind=goods').expect(200)).body).toHaveLength(1);
    expect((await as('auditor').get('/items?search=9983').expect(200)).body[0].name).toBe('Software development');
    await as('auditor').post('/items', { name: 'Nope' }).expect(403);
  });

  it('archives, deletes and keeps organisations apart', async () => {
    await as('owner').post(`/items/${dev}/archive`).expect(200);
    expect((await as('owner').get('/items').expect(200)).body).toHaveLength(1);
    expect((await as('owner').get('/items?archived=true').expect(200)).body[0].name).toBe('Software development');
    await as('ownerB', orgB).get(`/items/${dev}`).expect(404);
    await as('ownerB', orgB).post('/items', { name: 'Theirs', taxGroupId: gst18 }).expect(400);
    await as('owner').delete(`/items/${dev}`).expect(204);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'org.item.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.item.create', 'org.item.update', 'org.item.archive', 'org.item.delete']));
  });
});
