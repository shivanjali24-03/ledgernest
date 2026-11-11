import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

describe('Payment modes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let bank = '';
  let cash = '';
  let customer = '';
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const contact = (body: object) =>
    post('/contacts', { isCustomer: true, isVendor: true, ...body });

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
          name: `MODES ${run}`,
          slug: `modes-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
          addressLine1: 'Plot 4, Chakan MIDC',
          city: 'Pune',
          postalCode: '410501',
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
    const account = async (code: string, type: string, subtype: string) =>
      (
        await post('/accounts', {
          name: `${code} ${run}`,
          code,
          type,
          subtype,
        }).expect(201)
      ).body.id as string;
    bank = await account('1100', 'asset', 'bank');
    cash = await account('1000', 'asset', 'cash');
    await account('1200', 'asset', 'accounts_receivable');
    await account('2000', 'liability', 'accounts_payable');
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await contact({ name: 'Kumar Logistics', isVendor: false }).expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const receive = (body: object) =>
    post('/payments/receipts', {
      contactId: customer,
      date: '2026-06-10',
      bankAccountId: bank,
      amount: 5_000_00,
      ...body,
    });
  type View = {
    id: string;
    mode: string | null;
    instrumentNo: string | null;
    instrumentDate: string | null;
    drawnOn: string | null;
  };

  it('keeps a cheque’s number, date and bank, and prints them on the receipt', async () => {
    const r = (
      await receive({
        mode: 'cheque',
        instrumentNo: '004512',
        instrumentDate: '2026-06-08',
        drawnOn: 'HDFC Bank',
      }).expect(201)
    ).body as View;
    expect(r).toMatchObject({
      mode: 'cheque',
      instrumentNo: '004512',
      instrumentDate: '2026-06-08',
      drawnOn: 'HDFC Bank',
    });
    const pdf = await auth(http().get(`/api/v1/payments/${r.id}/pdf`))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((pdf.body as Buffer).toString('latin1')).toContain(
      'By Cheque 004512 dated 08/06/2026 on HDFC Bank',
    );
  });

  it('takes a UTR for a bank transfer, and refuses what isn’t one', async () => {
    const r = (
      await receive({
        mode: 'neft',
        instrumentNo: 'hdfcn52026061012345',
      }).expect(201)
    ).body as View;
    expect(r.instrumentNo).toBe('HDFCN52026061012345');
    const bad = await receive({ mode: 'rtgs', instrumentNo: 'X1' }).expect(400);
    expect(bad.body.details.map((d: { field: string }) => d.field)).toContain(
      'instrumentNo',
    );
    const stale = await receive({
      mode: 'cheque',
      instrumentNo: '004513',
      instrumentDate: '2026-01-02',
    }).expect(400);
    expect(stale.body.details.map((d: { field: string }) => d.field)).toContain(
      'instrumentDate',
    );
  });

  it('keeps cash to cash accounts, and takes cash as the mode of a cash account', async () => {
    const c = (await receive({ bankAccountId: cash }).expect(201)).body as View;
    expect(c.mode).toBe('cash');
    expect(
      (await receive({ bankAccountId: cash, mode: 'upi' }).expect(400)).body
        .details,
    ).toMatchObject({ reason: 'mode_account' });
    expect(
      (await receive({ mode: 'cash' }).expect(400)).body.details,
    ).toMatchObject({ reason: 'mode_account', field: 'bankAccountId' });
  });
});
