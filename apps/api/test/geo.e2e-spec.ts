import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaService as PrismaServiceType } from '../src/prisma/prisma.service.js';

/** A stand-in for India Post's PIN directory, so tests never touch the network */
function indiaPost(): Promise<{
  server: Server;
  url: string;
  calls: string[];
  down: { value: boolean };
}> {
  const calls: string[] = [];
  const down = { value: false };
  const server = createServer((req, res) => {
    calls.push(req.url!);
    if (down.value) return void res.writeHead(503).end();
    res.setHeader('Content-Type', 'application/json');
    const pin = req.url!.split('/').pop();
    // The IFSC directory's answers
    if (pin === 'HDFC0001234')
      return void res.end(
        JSON.stringify({
          BANK: 'HDFC Bank',
          IFSC: 'HDFC0001234',
          BRANCH: 'BANER',
          ADDRESS: 'Baner Road, Pune 411045',
          CITY: 'PUNE',
          STATE: 'MAHARASHTRA',
          UPI: true,
          NEFT: true,
          RTGS: true,
          IMPS: true,
        }),
      );
    if (pin === 'HDFC0009999')
      return void res.writeHead(404).end('"Not Found"');
    if (pin === '411045')
      return void res.end(
        JSON.stringify([
          {
            Message: 'Number of pincode(s) found:2',
            Status: 'Success',
            PostOffice: [
              {
                Name: 'Baner Gaon',
                DeliveryStatus: 'Non-Delivery',
                District: 'Pune',
                Block: 'Haveli',
                State: 'Maharashtra',
                Country: 'India',
                Pincode: '411045',
              },
              {
                Name: 'N.I.A.',
                DeliveryStatus: 'Delivery',
                District: 'Pune',
                Block: 'Pune City',
                State: 'Maharashtra',
                Country: 'India',
                Pincode: '411045',
              },
            ],
          },
        ]),
      );
    res.end(
      JSON.stringify([
        { Message: 'No records found', Status: 'Error', PostOffice: null },
      ]),
    );
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        calls,
        down,
      }),
    ),
  );
}

describe('Addresses from the PIN code (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let stub: Awaited<ReturnType<typeof indiaPost>>;
  const run = randomUUID().slice(0, 8);
  let token = '';
  const PINS = ['411045', '999998', '560001'];
  const IFSCS = ['HDFC0001234', 'HDFC0009999'];

  const get = (p: string, auth = true) => {
    const r = request(app.getHttpServer()).get(`/api/v1${p}`);
    return auth ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  beforeAll(async () => {
    stub = await indiaPost();
    process.env.INDIA_POST_URL = stub.url;
    process.env.IFSC_URL = stub.url;
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } = await import('../src/prisma/prisma.service.js');
    const { setupApp } = await import('../src/setup-app.js');
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.pincodeCache.deleteMany({ where: { pin: { in: PINS } } });
    await prisma.ifscCache.deleteMany({ where: { ifsc: { in: IFSCS } } });
    // Someone who has just signed up and has no organisation yet
    const u = await prisma.user.create({
      data: {
        email: `new-${run}@test.ledgernest.local`,
        name: 'New',
        passwordHash: 'unused',
      },
    });
    token = await app
      .get(JwtService)
      .signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.pincodeCache.deleteMany({ where: { pin: { in: PINS } } });
    await prisma.ifscCache.deleteMany({ where: { ifsc: { in: IFSCS } } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
    stub.server.close();
  });

  it('gives the state from the GST list, the district, towns and localities, and asks India Post only once', async () => {
    const first = (await get('/geo/pincode/411045').expect(200)).body;
    expect(first).toEqual({
      pin: '411045',
      state: { code: '27', name: 'Maharashtra' },
      district: 'Pune',
      cities: ['Pune', 'Haveli', 'Pune City'],
      localities: [
        {
          name: 'N.I.A.',
          block: 'Pune City',
          district: 'Pune',
          delivery: true,
        },
        {
          name: 'Baner Gaon',
          block: 'Haveli',
          district: 'Pune',
          delivery: false,
        },
      ],
    });
    expect((await get('/geo/pincode/411045').expect(200)).body).toEqual(first);
    expect(stub.calls.filter((c) => c === '/pincode/411045')).toHaveLength(1);
  });

  it('keeps answering from what it kept when India Post is down', async () => {
    await prisma.pincodeCache.update({
      where: { pin: '411045' },
      data: { fetchedAt: new Date('2020-01-01') },
    });
    stub.down.value = true;
    try {
      expect((await get('/geo/pincode/411045').expect(200)).body.district).toBe(
        'Pune',
      );
      expect(
        (await get('/geo/pincode/560001').expect(502)).body.details,
      ).toMatchObject({ reason: 'source_unavailable' });
    } finally {
      stub.down.value = false;
    }
  });

  it('says so for a PIN India Post doesn’t know, remembering it for a while', async () => {
    expect(
      (await get('/geo/pincode/999998').expect(404)).body.details,
    ).toMatchObject({ reason: 'unknown_pin' });
    await get('/geo/pincode/999998').expect(404);
    expect(stub.calls.filter((c) => c === '/pincode/999998')).toHaveLength(1);
  });

  it('refuses anything that isn’t a PIN, without asking India Post, and needs sign-in', async () => {
    const before = stub.calls.length;
    for (const bad of [
      '041104',
      '41104',
      '4110451',
      'abcdef',
      '411045%2F..%2Fx',
    ])
      expect(
        (await get(`/geo/pincode/${bad}`).expect(400)).body.details,
      ).toMatchObject({ reason: 'invalid_pin' });
    expect(stub.calls.length).toBe(before);
    await get('/geo/pincode/411045', false).expect(401);
  });

  it('fills a bank branch from its IFSC, asking the directory once, and refuses anything that isn’t one', async () => {
    const before = stub.calls.length;
    const b = (await get('/geo/ifsc/hdfc0001234').expect(200)).body;
    expect(b).toMatchObject({
      ifsc: 'HDFC0001234',
      bank: 'HDFC Bank',
      branch: 'BANER',
      upi: true,
    });
    await get('/geo/ifsc/HDFC0001234').expect(200);
    expect(stub.calls.length - before).toBe(1);
    expect(
      (await get('/geo/ifsc/HDFC0009999').expect(404)).body.details,
    ).toMatchObject({ reason: 'unknown_ifsc' });
    // Nothing that isn't an IFSC reaches the directory
    expect(
      (await get('/geo/ifsc/..%2F..%2Fetc').expect(400)).body.details,
    ).toMatchObject({ reason: 'invalid_ifsc' });
    await get('/geo/ifsc/HDFC0001234', false).expect(401);
  });
});
