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

describe('GST registration type per party (e2e)', () => {
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
          name: `GSTT ${run}`,
          slug: `gstt-${run}`,
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

  const fields = async (body: object) =>
    (
      (await contact(body).expect(400)).body as {
        details: { field: string }[];
      }
    ).details.map((d) => d.field);

  it('checks the registration type against the GSTIN and country', async () => {
    expect(
      await fields({ name: 'No GSTIN SEZ', gstTreatment: 'sez' }),
    ).toContain('taxId');
    expect(
      await fields({
        name: 'Registered consumer',
        gstTreatment: 'consumer',
        taxId: gstin('27AABCC1234K1Z'),
      }),
    ).toContain('gstTreatment');
    expect(
      await fields({
        name: 'Overseas in India',
        gstTreatment: 'overseas',
        billingAddress: { country: 'IN' },
      }),
    ).toContain('billingAddress.country');
    const c = (
      await contact({
        name: 'Plain shop',
        billingAddress: { country: 'IN', region: 'Maharashtra' },
      }).expect(201)
    ).body as { gstTreatment: string | null };
    expect(c.gstTreatment).toBeNull();
  });

  it('only makes SEZ supplies to an SEZ customer', async () => {
    const sez = (
      await contact({
        name: 'Magarpatta SEZ unit',
        gstTreatment: 'sez',
        taxId: gstin('27AABCM9876K1Z'),
      }).expect(201)
    ).body.id as string;
    const inv = (supplyKind: string) =>
      post('/invoices', {
        contactId: sez,
        issueDate: '2026-06-10',
        supplyKind,
        lines: [{ ...line(), accountId: sales }],
      });
    expect(
      (
        (await inv('regular').expect(400)).body as {
          details: { reason: string };
        }
      ).details.reason,
    ).toBe('sez_customer');
    await inv('sez_with_igst').expect(201);
  });

  it('refuses GST on a bill from a composition dealer', async () => {
    const dealer = (
      await contact({
        name: 'Small composition trader',
        gstTreatment: 'composition',
        taxId: gstin('27AABCS5555K1Z'),
      }).expect(201)
    ).body.id as string;
    const bill = (lines: object[]) =>
      post('/bills', { contactId: dealer, billDate: '2026-06-10', lines });
    expect(
      (
        (await bill([line()]).expect(400)).body as {
          details: { reason: string };
        }
      ).details.reason,
    ).toBe('vendor_composition');
    await bill([{ ...line(), taxGroupId: null }]).expect(201);
  });
});
