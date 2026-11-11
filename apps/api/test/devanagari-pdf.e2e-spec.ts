import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/** UTF-16BE hex, as a PDF's ActualText carries the words it draws as glyphs */
const utf16 = (s: string) =>
  s
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');

/** Customers, items and notes written in Hindi or Marathi print on PDFs in Devanagari, not as "?" */
describe('Devanagari on PDFs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const pdf = async (p: string) =>
    (
      (
        await auth(http().get(`/api/v1${p}`))
          .buffer(true)
          .parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          })
          .expect(200)
      ).body as Buffer
    ).toString('latin1');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Devanagari ${run}`,
          slug: `devanagari-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    const u = await prisma.user.create({
      data: {
        email: `owner-${run}@test.ledgernest.local`,
        name: 'Owner',
        passwordHash: 'unused',
      },
    });
    await prisma.membership.create({
      data: { userId: u.id, organizationId: org, builtInRole: 'owner' },
    });
    token = await app
      .get(JwtService)
      .signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
    await post('/accounts', {
      name: `debtors ${run}`,
      code: '1300',
      type: 'asset',
      subtype: 'accounts_receivable',
    }).expect(201);
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('prints a Marathi customer and a Hindi line in the embedded Devanagari font', async () => {
    const sales = (
      await post('/accounts', {
        name: `sales ${run}`,
        code: '4100',
        type: 'income',
        subtype: 'operating_income',
      }).expect(201)
    ).body.id as string;
    const customer = (
      await post('/contacts', {
        name: 'श्री गणेश ट्रेडर्स',
        isCustomer: true,
        isVendor: false,
      }).expect(201)
    ).body.id as string;
    const inv = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-06-10',
        lines: [
          {
            description: 'सरसों तेल',
            quantity: 2,
            unitPrice: 180_00,
            accountId: sales,
          },
        ],
      }).expect(201)
    ).body.id as string;
    await post(`/invoices/${inv}/issue`).expect(200);
    const t = await pdf(`/invoices/${inv}/pdf`);
    expect(t).toContain(
      '/Subtype /Type0 /BaseFont /NotoSansDevanagari-Regular /Encoding /Identity-H',
    );
    expect(t).toContain('/FontFile2');
    // Each word drawn as glyphs, carrying its own text
    for (const word of ['श्री', 'गणेश', 'ट्रेडर्स', 'सरसों', 'तेल'])
      expect(t).toContain(`/ActualText <FEFF${utf16(word)}>`);
    expect(t).not.toContain('????');
  });
});
