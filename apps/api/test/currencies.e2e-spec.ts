import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaService as PrismaServiceType } from '../src/prisma/prisma.service.js';

/** A stand-in for the European Central Bank rates service (Frankfurter), so tests never touch the network. */
function rateServer(): Promise<{ server: Server; url: string; calls: string[] }> {
  const calls: string[] = [];
  const RATES: Record<string, number> = { USD: 93.92, EUR: 101.4567 };
  const server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    calls.push(`${u.pathname}${u.search}`);
    const from = u.searchParams.get('from')!;
    const to = u.searchParams.get('to')!;
    res.setHeader('Content-Type', 'application/json');
    if (!(from in RATES) || to !== 'INR') return void res.writeHead(404).end(JSON.stringify({ message: 'not found' }));
    // The ECB publishes on working days: a Sunday request gets Friday's rate
    const date = u.pathname.endsWith('/2026-11-08') ? '2026-11-06' : u.pathname.endsWith('/latest') ? '2026-11-06' : u.pathname.split('/').pop()!;
    res.end(JSON.stringify({ amount: 1, base: from, date, rates: { [to]: RATES[from] } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls })));
}

describe('Currencies and exchange rates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let jwt: JwtService;
  let stub: Awaited<ReturnType<typeof rateServer>>;
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
      put: (p: string, body: object) => auth(http().put(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };

  beforeAll(async () => {
    stub = await rateServer();
    // Set before the app module loads, as configuration is read when it's imported
    process.env.FX_RATES_URL = stub.url;
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } = await import('../src/prisma/prisma.service.js');
    const { setupApp } = await import('../src/setup-app.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `FX A ${run}`, slug: `fx-a-${run}`, baseCurrency: 'INR' } })).id;
    orgB = (await prisma.organization.create({ data: { name: `FX B ${run}`, slug: `fx-b-${run}` } })).id;
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
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
    stub.server.close();
  });

  it('enables currencies, but not the base currency, an unknown code or the same one twice', async () => {
    const r = (await as('owner').post('/currencies', { code: 'usd' }).expect(201)).body;
    expect(r).toMatchObject({ base: 'INR', currencies: [{ code: 'USD', digits: 2, latest: null, rateCount: 0 }] });
    await as('owner').post('/currencies', { code: 'EUR' }).expect(201);
    await as('owner').post('/currencies', { code: 'AED' }).expect(201);
    expect((await as('owner').post('/currencies', { code: 'INR' }).expect(409)).body.details.reason).toBe('is_base');
    expect((await as('owner').post('/currencies', { code: 'USD' }).expect(409)).body.details.reason).toBe('already_enabled');
    await as('owner').post('/currencies', { code: 'XYZ' }).expect(400);
    await as('viewer').post('/currencies', { code: 'GBP' }).expect(403);
    expect((await as('viewer').get('/currencies').expect(200)).body.currencies.map((c: { code: string }) => c.code)).toEqual(['AED', 'EUR', 'USD']);
  });

  it('takes rates by hand, normalised, and uses the latest one on or before a day', async () => {
    expect((await as('owner').put('/currencies/AED/rates/2026-11-02', { rate: '025.5700' }).expect(200)).body).toEqual({ date: '2026-11-02', rate: '25.57', source: 'manual' });
    await as('owner').put('/currencies/AED/rates/2026-11-05', { rate: 25.61 }).expect(200);
    await as('owner').put('/currencies/AED/rates/2026-11-05', { rate: '0' }).expect(400);
    await as('owner').put('/currencies/AED/rates/2026-02-30', { rate: '1' }).expect(400);
    await as('owner').put('/currencies/GBP/rates/2026-11-05', { rate: '110' }).expect(404);
    const rates = (await as('viewer').get('/currencies/AED/rates').expect(200)).body;
    expect(rates.map((r: { date: string; rate: string }) => [r.date, r.rate])).toEqual([
      ['2026-11-05', '25.61'],
      ['2026-11-02', '25.57'],
    ]);
    const { CurrenciesService } = await import('../src/currencies/currencies.service.js');
    expect(await CurrenciesService.rateOn(prisma, orgA, 'AED', '2026-11-04')).toMatchObject({ date: '2026-11-02', rate: '25.57' });
    expect(await CurrenciesService.rateOn(prisma, orgA, 'AED', '2026-11-01')).toBeNull();
  });

  it("fetches the ECB's rates, saving them on the day they were published, and lists what it doesn't cover", async () => {
    // A rate typed by hand for EUR on that day is kept
    await as('owner').put('/currencies/EUR/rates/2026-11-06', { rate: '101' }).expect(200);
    const r = (await as('owner').post('/currencies/rates/fetch', { date: '2026-11-08' }).expect(200)).body;
    expect(r).toEqual({ saved: [{ code: 'USD', date: '2026-11-06', rate: '93.92' }], keptManual: ['EUR'], unsupported: ['AED'], failed: 0 });
    expect(stub.calls).toEqual(expect.arrayContaining(['/2026-11-08?from=USD&to=INR', '/2026-11-08?from=EUR&to=INR', '/2026-11-08?from=AED&to=INR']));
    const usd = (await as('owner').get('/currencies/USD/rates').expect(200)).body;
    expect(usd).toEqual([expect.objectContaining({ date: '2026-11-06', rate: '93.92', source: 'ecb' })]);
    // Fetching again replaces a fetched rate but still never a typed one
    await as('owner').post('/currencies/rates/fetch', {}).expect(200);
    expect((await as('owner').get('/currencies/EUR/rates').expect(200)).body[0]).toMatchObject({ rate: '101', source: 'manual' });
    await as('viewer').post('/currencies/rates/fetch', {}).expect(403);
  });

  it("says so when the rate service can't be reached", async () => {
    const saved = process.env.FX_RATES_URL;
    // Point the running service at a closed port by stopping the stub briefly
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    const r = await as('owner').post('/currencies/rates/fetch', {}).expect(502);
    expect(r.body.details.reason).toBe('source_unavailable');
    await new Promise<void>((resolve) => stub.server.listen(Number(new URL(saved!).port), '127.0.0.1', () => resolve()));
  });

  it('audits every change', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'org.' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['org.currency.add', 'org.exchange_rate.set', 'org.exchange_rate.fetch']));
  });

  it("won't make an enabled foreign currency the base currency", async () => {
    const r = await as('owner').patch('/organization', { baseCurrency: 'USD' }).expect(409);
    expect(r.body.details.reason).toBe('currency_enabled');
  });

  it('removes a currency with its rates, and other organisations see none of it', async () => {
    expect((await as('ownerB', orgB).get('/currencies').expect(200)).body.currencies).toEqual([]);
    await as('ownerB', orgB).get('/currencies/USD/rates').expect(404);
    await as('ownerB', orgB).delete('/currencies/USD').expect(404);
    await as('owner').delete('/currencies/AED').expect(204);
    expect(await prisma.exchangeRate.count({ where: { organizationId: orgA, currency: 'AED' } })).toBe(0);
    await as('owner').delete('/currencies/AED/rates/2026-11-05').expect(404);
  });
});
