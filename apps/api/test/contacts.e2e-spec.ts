import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

describe('Customers and vendors (e2e)', () => {
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
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `Contacts A ${run}`, slug: `contacts-a-${run}`, country: 'IN', region: 'Maharashtra' } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Contacts B ${run}`, slug: `contacts-b-${run}` } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['viewer', orgA, 'viewer'],
      ['bookkeeper', orgA, 'bookkeeper'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    await prisma.organizationCurrency.create({ data: { organizationId: orgA, code: 'USD' } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  let kumar = '';

  it('adds an Indian customer, taking the state of supply from the GSTIN', async () => {
    const c = (await as('bookkeeper').post('/contacts', { name: 'Kumar Logistics', isCustomer: true, isVendor: false, taxId: '27aapfu0939f1zv', email: 'accounts@kumar.example', billingAddress: { line1: '12 MG Road', city: 'Pune', country: 'IN' }, paymentTermsDays: 15 }).expect(201)).body;
    kumar = c.id;
    expect(c).toMatchObject({ name: 'Kumar Logistics', taxId: '27AAPFU0939F1ZV', stateCode: '27', paymentTermsDays: 15, currency: null, shippingAddress: null, billingAddress: { city: 'Pune', region: null } });
  });

  it('refuses a bad GSTIN, a GSTIN from another state, duplicate names and currencies not enabled', async () => {
    const r = async (body: object, status: number) => (await as('owner').post('/contacts', { name: `X ${randomUUID().slice(0, 4)}`, isCustomer: true, isVendor: false, ...body }).expect(status)).body;
    await r({ taxId: '27AAPFU0939F1ZW', billingAddress: { country: 'IN' } }, 400);
    await r({ taxId: '27AAPFU0939F1ZV', billingAddress: { country: 'IN', region: 'Karnataka' } }, 400);
    await r({ isCustomer: false }, 400);
    expect((await as('owner').post('/contacts', { name: 'kumar logistics', isCustomer: false, isVendor: true }).expect(409)).body.details.reason).toBe('name_taken');
    expect((await r({ currency: 'EUR' }, 400)).details.reason).toBe('currency_not_enabled');
  });

  it('keeps foreign customers in their currency, and the base currency as none', async () => {
    const acme = (await as('owner').post('/contacts', { name: 'Acme Inc.', isCustomer: true, isVendor: true, taxId: 'US-12-3456789', currency: 'usd', billingAddress: { city: 'Austin', region: 'Texas', country: 'US' } }).expect(201)).body;
    expect(acme).toMatchObject({ currency: 'USD', stateCode: null, isVendor: true });
    const local = (await as('owner').post('/contacts', { name: 'Local Stationers', isCustomer: false, isVendor: true, currency: 'INR', billingAddress: { region: 'Kerala', country: 'IN' } }).expect(201)).body;
    expect(local).toMatchObject({ currency: null, stateCode: '32' });
  });

  it('updates only what changes, re-checking the whole contact', async () => {
    const u = (await as('owner').patch(`/contacts/${kumar}`, { paymentTermsDays: 30, shippingAddress: { line1: 'Warehouse 4', city: 'Bhiwandi', region: 'Maharashtra', country: 'IN' } }).expect(200)).body;
    expect(u).toMatchObject({ paymentTermsDays: 30, shippingAddress: { city: 'Bhiwandi' }, email: 'accounts@kumar.example' });
    await as('owner').patch(`/contacts/${kumar}`, { billingAddress: { city: 'Pune', region: 'Karnataka', country: 'IN' } }).expect(400);
    const cleared = (await as('owner').patch(`/contacts/${kumar}`, { shippingAddress: null }).expect(200)).body;
    expect(cleared.shippingAddress).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: kumar, action: 'org.contact.update' }, orderBy: { createdAt: 'asc' }, select: { before: true, after: true } });
    expect(audit?.before).toMatchObject({ paymentTermsDays: 15 });
  });

  it('lists, searches and filters customers and vendors', async () => {
    // Viewers see the accounts but not who the business trades with
    await as('viewer').get('/contacts').expect(403);
    const all = (await as('bookkeeper').get('/contacts').expect(200)).body;
    expect(all.items.map((c: { name: string }) => c.name)).toEqual(['Acme Inc.', 'Kumar Logistics', 'Local Stationers']);
    expect((await as('bookkeeper').get('/contacts?type=vendor').expect(200)).body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Inc.', 'Local Stationers']);
    expect((await as('bookkeeper').get('/contacts?search=27AAP').expect(200)).body.items).toHaveLength(1);
    await as('viewer').post('/contacts', { name: 'Nope', isCustomer: true, isVendor: false }).expect(403);
  });

  it('archives, restores and deletes, and other organisations see none of it', async () => {
    await as('owner').post(`/contacts/${kumar}/archive`).expect(200);
    expect((await as('owner').get('/contacts').expect(200)).body.total).toBe(2);
    expect((await as('owner').get('/contacts?archived=true').expect(200)).body.items[0].name).toBe('Kumar Logistics');
    await as('owner').post(`/contacts/${kumar}/restore`).expect(200);
    await as('ownerB', orgB).get(`/contacts/${kumar}`).expect(404);
    await as('ownerB', orgB).patch(`/contacts/${kumar}`, { name: 'Mine' }).expect(404);
    expect((await as('ownerB', orgB).get('/contacts').expect(200)).body.total).toBe(0);
    await as('owner').delete(`/contacts/${kumar}`).expect(204);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'org.contact.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.contact.create', 'org.contact.update', 'org.contact.archive', 'org.contact.restore', 'org.contact.delete']));
  });
});
