import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { depreciationFor } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Asset = {
  id: string;
  tag: string;
  accumulated: number;
  bookValue: number;
  depreciatedTo: string | null;
  status: string;
  disposalEntry: { id: string } | null;
};
type Run = {
  id: string;
  total: number;
  journalEntry: { id: string };
  lines: { asset: { tag: string }; amount: number }[];
};

describe('Fixed assets and depreciation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const asset: Record<string, Asset> = {};
  let org = '';
  let june: Run;

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      put: (p: string, body: object) =>
        auth(http().put(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const get = async (a: Asset) =>
    (await as().get(`/fixed-assets/${a.id}`).expect(200)).body as Asset;
  const lines = async (entryId: string) =>
    (
      (await as().get(`/journals/${entryId}`).expect(200)).body.lines as {
        account: { code: string };
        debit: number;
        credit: number;
      }[]
    ).map((l) => [l.account.code, l.debit, l.credit]);

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
          name: `Assets ${run}`,
          slug: `assets-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
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
          name: `User ${key}`,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = {
        id: u.id,
        token: await jwt.signAsync(
          { sub: u.id, sa: false },
          { expiresIn: '15m' },
        ),
      };
    }
    for (const [key, body] of [
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      ['equipment', { code: '1710', type: 'asset', subtype: 'fixed_asset' }],
      ['accumulated', { code: '1790', type: 'asset', subtype: 'fixed_asset' }],
      ['disposals', { code: '4900', type: 'income', subtype: 'other_income' }],
      [
        'depreciation',
        { code: '5700', type: 'expense', subtype: 'depreciation' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: key, ...body })
          .expect(201)
      ).body.id;
    }
    for (const y of [2025, 2026])
      await as().post('/fiscal-years', { startYear: y }).expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  const accounts = () => ({
    costAccountId: acc.equipment,
    accumulatedAccountId: acc.accumulated,
    expenseAccountId: acc.depreciation,
  });

  it('adds assets: straight-line, written-down value, and one already part depreciated', async () => {
    expect(
      (
        await as()
          .post('/fixed-assets', {
            name: 'x',
            ...accounts(),
            costAccountId: acc.bank,
            cost: 100,
            inServiceDate: '2026-04-01',
            method: 'straight_line',
            usefulLifeMonths: 12,
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('cost_account');
    await as('auditor').post('/fixed-assets', {}).expect(403);
    asset.laptop = (
      await as()
        .post('/fixed-assets', {
          name: 'MacBook Pro',
          ...accounts(),
          cost: 12_000_000,
          inServiceDate: '2026-04-16',
          method: 'straight_line',
          usefulLifeMonths: 36,
        })
        .expect(201)
    ).body;
    asset.car = (
      await as()
        .post('/fixed-assets', {
          name: 'Delivery van',
          ...accounts(),
          cost: 10_000_000,
          inServiceDate: '2026-04-01',
          method: 'wdv',
          wdvRate: '40',
        })
        .expect(201)
    ).body;
    asset.desks = (
      await as()
        .post('/fixed-assets', {
          name: 'Office desks',
          ...accounts(),
          cost: 2_000_000,
          inServiceDate: '2025-04-01',
          method: 'straight_line',
          usefulLifeMonths: 20,
          openingAccumulated: 500_000,
          openingTo: '2026-03-31',
        })
        .expect(201)
    ).body;
    expect([asset.laptop.tag, asset.car.tag, asset.desks.tag]).toEqual([
      'FA-0001',
      'FA-0002',
      'FA-0003',
    ]);
    expect(asset.desks).toMatchObject({
      accumulated: 500_000,
      bookValue: 1_500_000,
      depreciatedTo: '2026-03-31',
    });
  });

  it('previews and runs a quarter’s depreciation in one entry', async () => {
    const car = depreciationFor(
      {
        method: 'wdv',
        cost: 10_000_000,
        residual: 0,
        accumulated: 0,
        usefulLifeMonths: null,
        wdvRatePpm: 400_000,
      },
      '2026-04-01',
      '2026-06-30',
    );
    const p = (
      await as('auditor')
        .get('/fixed-assets/depreciation/preview?upTo=2026-06-30')
        .expect(200)
    ).body as {
      total: number;
      lines: { tag: string; from: string; amount: number }[];
    };
    // The laptop from 16 April (half a month) at ₹3,333.33 a month; the desks ₹1,000 a month from April
    expect(p.lines.map((l) => [l.tag, l.from, l.amount])).toEqual([
      ['FA-0001', '2026-04-16', 833_333],
      ['FA-0002', '2026-04-01', car],
      ['FA-0003', '2026-04-01', 300_000],
    ]);
    june = (
      await as()
        .post('/fixed-assets/depreciation/runs', { upTo: '2026-06-30' })
        .expect(201)
    ).body;
    expect(june.total).toBe(p.total);
    expect(await lines(june.journalEntry.id)).toEqual([
      ['5700', 833_333, 0],
      ['1790', 0, 833_333],
      ['5700', car, 0],
      ['1790', 0, car],
      ['5700', 300_000, 0],
      ['1790', 0, 300_000],
    ]);
    expect(await get(asset.laptop)).toMatchObject({
      accumulated: 833_333,
      depreciatedTo: '2026-06-30',
    });
    expect(
      (
        await as()
          .post('/fixed-assets/depreciation/runs', { upTo: '2026-06-30' })
          .expect(409)
      ).body.details.reason,
    ).toBe('nothing_to_depreciate');
    expect(
      (
        await as()
          .post(`/journals/${june.journalEntry.id}/reverse`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('document_entry');
  });

  it('undoes only the latest run, putting each asset back', async () => {
    const july = (
      await as()
        .post('/fixed-assets/depreciation/runs', { upTo: '2026-07-31' })
        .expect(201)
    ).body as Run;
    expect(
      (
        await as()
          .delete(`/fixed-assets/depreciation/runs/${june.id}`)
          .expect(409)
      ).body.details.reason,
    ).toBe('not_latest');
    await as().delete(`/fixed-assets/depreciation/runs/${july.id}`).expect(204);
    expect(await get(asset.laptop)).toMatchObject({
      accumulated: 833_333,
      depreciatedTo: '2026-06-30',
    });
    expect(
      (await as('auditor').get('/fixed-assets/depreciation/runs').expect(200))
        .body,
    ).toHaveLength(1);
  });

  it('disposes of the laptop: depreciation to the day, then the loss on what it fetched', async () => {
    expect(
      (await as().delete(`/fixed-assets/${asset.laptop.id}`).expect(409)).body
        .details.reason,
    ).toBe('has_depreciation');
    const d = (
      await as()
        .post(`/fixed-assets/${asset.laptop.id}/dispose`, {
          date: '2026-07-15',
          proceeds: 10_000_000,
          bankAccountId: acc.bank,
          gainLossAccountId: acc.disposals,
        })
        .expect(200)
    ).body as Asset;
    // 15 of July's 31 days: ₹1,612.90; book value then ₹1,10,053.77, sold for ₹1,00,000
    expect(d).toMatchObject({
      status: 'disposed',
      accumulated: 994_623,
      bookValue: 0,
    });
    expect(await lines(d.disposalEntry!.id)).toEqual([
      ['5700', 161_290, 0],
      ['1790', 833_333, 0],
      ['1100', 10_000_000, 0],
      ['1710', 0, 12_000_000],
      ['4900', 1_005_377, 0],
    ]);
    await as()
      .post(`/fixed-assets/${asset.laptop.id}/dispose`, {
        date: '2026-07-20',
        gainLossAccountId: acc.disposals,
      })
      .expect(409);
  });

  it('schedules the period: opening, additions, depreciation, disposals and closing', async () => {
    const s = (
      await as('auditor')
        .get('/fixed-assets/schedule?from=2026-04-01&to=2026-07-31')
        .expect(200)
    ).body as {
      rows: Record<string, number | string>[];
      totals: Record<string, number>;
    };
    expect(s.rows.find((r) => r.tag === 'FA-0001')).toMatchObject({
      openingCost: 0,
      additions: 12_000_000,
      disposals: 12_000_000,
      closingCost: 0,
      depreciation: 994_623,
      depreciationOnDisposals: 994_623,
      closingDepreciation: 0,
      closingBookValue: 0,
    });
    expect(s.rows.find((r) => r.tag === 'FA-0003')).toMatchObject({
      openingCost: 2_000_000,
      openingDepreciation: 500_000,
      depreciation: 300_000,
      closingDepreciation: 800_000,
      closingBookValue: 1_200_000,
    });
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.asset.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.asset.create',
        'org.asset.depreciate',
        'org.asset.depreciate_undo',
        'org.asset.dispose',
      ]),
    );
  });
});
