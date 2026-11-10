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

describe('Purchases under the composition scheme (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let gst18 = '';
  let sharma = '';
  let bill = { id: '', lines: [] as { id: string }[] };

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };
  const record = async (lines: object[], billDate = '2026-10-05') => {
    const b = (
      await as()
        .post('/bills', {
          contactId: sharma,
          vendorReference: `SOS/${randomUUID().slice(0, 4)}`,
          billDate,
          lines,
        })
        .expect(201)
    ).body as { id: string; lines: { id: string }[] };
    await as().post(`/bills/${b.id}/record`).expect(200);
    // The lines as recorded
    return (await as().get(`/bills/${b.id}`).expect(200)).body as {
      id: string;
      lines: { id: string }[];
    };
  };
  const tb = async (accountId: string) => {
    const rows = (
      (await as().get('/reports/trial-balance?asOf=2026-10-31').expect(200))
        .body as {
        rows: {
          accountId: string;
          balanceDebit: number;
          balanceCredit: number;
        }[];
      }
    ).rows;
    const r = rows.find((x) => x.accountId === accountId);
    return r ? r.balanceDebit - r.balanceCredit : 0;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Composition ${run}`,
          slug: `composition-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
          gstScheme: 'composition',
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: key,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'furniture',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Office Supplies',
          isVendor: true,
          isCustomer: false,
          taxId: gstin('27ABZPS6519M1Z'),
        })
        .expect(201)
    ).body.id;
    // Four chairs at ₹5,000 and two lamps at ₹1,000, GST 18%: ₹25,960
    bill = await record([
      {
        description: 'Office chair',
        quantity: 4,
        unitPrice: 5_000_00,
        taxGroupId: gst18,
        accountId: acc.furniture,
      },
      {
        description: 'Desk lamp',
        quantity: 2,
        unitPrice: 1_000_00,
        taxGroupId: gst18,
        accountId: acc.furniture,
      },
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('puts the GST on a bill into its cost, as no input credit can be claimed, and a debit note takes it back the same way', async () => {
    // Bill recorded in beforeAll: four chairs at ₹5,000 and two lamps at ₹1,000 with 18% GST, ₹25,960 in all
    expect(await tb(acc.furniture)).toBe(25_960_00);
    const entry = (await as().get(`/bills/${bill.id}`).expect(200)).body as {
      journalEntry: { id: string };
    };
    const lines = (
      (await as().get(`/journals/${entry.journalEntry.id}`).expect(200))
        .body as {
        lines: { account: { name: string } }[];
      }
    ).lines;
    expect(lines.some((l) => /GST/.test(l.account.name))).toBe(false);
    await as()
      .post('/debit-notes', {
        billId: bill.id,
        date: '2026-10-12',
        lines: [{ billLineId: bill.lines[0]!.id, quantity: '1' }],
      })
      .expect(201);
    // One chair back: ₹5,000 and its ₹900 GST come off the cost
    expect(await tb(acc.furniture)).toBe(25_960_00 - 5_900_00);
  });
});
