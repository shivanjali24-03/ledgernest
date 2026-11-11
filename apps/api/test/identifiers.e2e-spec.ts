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

describe('Organisation and party identifiers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';
  let expense = '';
  let gst18 = '';
  let sales = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const contact = (body: object) =>
    post('/contacts', { isCustomer: true, isVendor: true, ...body });
  const line = () => ({
    description: 'Service',
    quantity: 1,
    unitPrice: 1_000_00,
    taxGroupId: gst18,
    accountId: expense,
  });

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
          name: `IDS ${run}`,
          slug: `ids-${run}`,
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
    await post('/fiscal-years', { startYear: 2026 }).expect(201);
    const groups = (await post('/taxes/gst-setup').expect(200)).body.groups as {
      id: string;
      name: string;
    }[];
    gst18 = groups.find((g) => g.name === 'GST 18%')!.id;
    await post('/accounts', {
      name: `creditors ${run}`,
      code: '2000',
      type: 'liability',
      subtype: 'accounts_payable',
    }).expect(201);
    const account = async (code: string, type: string, subtype: string) =>
      (
        await post('/accounts', {
          name: `${code} ${run}`,
          code,
          type,
          subtype,
        }).expect(201)
      ).body.id as string;
    expense = await account('5100', 'expense', 'operating_expense');
    sales = await account('4100', 'income', 'operating_income');
    await account('1200', 'asset', 'accounts_receivable');
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const patchOrg = (body: object) =>
    auth(http().patch('/api/v1/organization')).send(body);

  it('keeps PAN, TAN, CIN and IEC, checked against the GSTIN and the kind of business', async () => {
    // The organisation's GSTIN 27AAPFN1234C… carries PAN AAPFN1234C: a firm
    const bad = await patchOrg({ pan: 'AAPCN1234C' }).expect(400);
    expect(bad.body.details).toMatchObject({
      reason: 'identifier',
      field: 'pan',
    });
    await patchOrg({
      businessType: 'llp',
      pan: 'aapfn1234c',
      tan: 'PNEN12345A',
      cin: 'AAB-1234',
      iec: 'AAPFN1234C',
    }).expect(200);
    const o = (await auth(http().get('/api/v1/organization')).expect(200)).body
      .organization as Record<string, string>;
    expect(o).toMatchObject({
      businessType: 'llp',
      pan: 'AAPFN1234C',
      tan: 'PNEN12345A',
      cin: 'AAB-1234',
    });
    const cin = await patchOrg({ cin: 'U72200MH2020PTC123456' }).expect(400);
    expect(cin.body.details).toMatchObject({ field: 'cin' });
  });

  it('prints the PAN, LLPIN and bank account on invoices', async () => {
    const bad = await patchOrg({
      bankDetails: { accountName: 'Nest', accountNumber: '12', ifsc: 'X' },
    }).expect(400);
    expect(bad.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['bankDetails.accountNumber', 'bankDetails.ifsc']),
    );
    await patchOrg({
      bankDetails: {
        accountName: 'Nest Demo LLP',
        accountNumber: '5010 0123 4567 89',
        ifsc: 'hdfc0001234',
        bankName: 'HDFC Bank',
        branch: 'Baner',
      },
    }).expect(200);
    const customer = (
      await contact({ name: 'Buyer', isVendor: false }).expect(201)
    ).body.id as string;
    const inv = (
      await post('/invoices', {
        contactId: customer,
        issueDate: '2026-06-10',
        lines: [{ ...line(), accountId: sales }],
      }).expect(201)
    ).body as { id: string };
    await post(`/invoices/${inv.id}/issue`).expect(200);
    const pdf = await auth(http().get(`/api/v1/invoices/${inv.id}/pdf`))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text).toContain('PAN AAPFN1234C');
    expect(text).toContain('LLPIN AAB-1234');
    expect(text).toContain('A/c 50100123456789');
    expect(text).toContain('IFSC HDFC0001234');
    // And it can be taken off again
    await patchOrg({ bankDetails: null }).expect(200);
  });

  it('keeps a vendor’s PAN for TDS, checked against their GSTIN', async () => {
    const res = await contact({
      name: 'Mismatched',
      taxId: gstin('27AABCS5555K1Z'),
      pan: 'AABCT5555K',
    }).expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain(
      'pan',
    );
    const c = (
      await contact({ name: 'Adv. Kulkarni', pan: 'abcpk1234f' }).expect(201)
    ).body as { pan: string };
    expect(c.pan).toBe('ABCPK1234F');
  });
});
