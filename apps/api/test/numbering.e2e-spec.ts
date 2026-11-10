import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Series = {
  id: string;
  type: string;
  name: string;
  prefix: string;
  isDefault: boolean;
  archived: boolean;
  preview: string;
  used: number;
};
type Invoice = { id: string; number: string | null; lines: { id: string }[] };

describe('Number series (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let other = '';
  let customer = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, o = org) => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${tokens[who]}`)
        .set('X-Organization-Id', o);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const owner = () => as('owner');
  const series = async () =>
    (await owner().get('/number-series').expect(200)).body as {
      yearName: string;
      items: Series[];
    };
  const invoice = async (issueDate: string, seriesId?: string) => {
    const d = (
      await owner()
        .post('/invoices', {
          contactId: customer,
          issueDate,
          ...(seriesId ? { seriesId } : {}),
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice: 1_000_00,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body as Invoice;
    return (await owner().post(`/invoices/${d.id}/issue`).expect(200))
      .body as Invoice;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    org = (
      await prisma.organization.create({
        data: {
          name: `Numbering ${run}`,
          slug: `numbering-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    other = (
      await prisma.organization.create({
        data: { name: `Numbering other ${run}`, slug: `numbering-o-${run}` },
      })
    ).id;
    for (const [who, o, role] of [
      ['owner', org, 'owner'],
      ['sales', org, 'accountant'],
      ['viewer', org, 'viewer'],
      ['otherOwner', other, 'owner'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${who}-${run}@test.ledgernest.local`,
          name: who,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: o, builtInRole: role },
      });
      tokens[who] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const)
      acc[key] = (
        await owner()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    await owner().post('/fiscal-years', { startYear: 2026 }).expect(201);
    customer = (
      await owner()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [org, other] } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('starts every organisation with the numbers LedgerNest always gave', async () => {
    const s = await series();
    expect(
      s.items.map((x) => [x.type, x.name, x.preview, x.isDefault]),
    ).toEqual([
      ['invoice', 'Tax invoices', 'INV/2026-27/0001', true],
      ['credit_note', 'Credit notes', 'CN/2026-27/0001', true],
      ['debit_note', 'Debit notes', 'DN/2026-27/0001', true],
    ]);
    expect((await invoice('2026-05-10')).number).toBe('INV/2026-27/0001');
  });

  it('numbers from a chosen series with its own prefix, digits and start, and the default carries on', async () => {
    const exp = (
      await owner()
        .post('/number-series', {
          type: 'invoice',
          name: 'Exports',
          prefix: 'EXP/{FY2}/',
          digits: 3,
          startNumber: 101,
        })
        .expect(201)
    ).body as Series;
    expect(exp).toMatchObject({ preview: 'EXP/26-27/101', isDefault: false });
    expect((await invoice('2026-05-11', exp.id)).number).toBe('EXP/26-27/101');
    expect((await invoice('2026-05-12', exp.id)).number).toBe('EXP/26-27/102');
    expect((await invoice('2026-05-12')).number).toBe('INV/2026-27/0002');
    // Found by the number as written
    const found = (
      await owner().get('/invoices?search=EXP/26-27/102').expect(200)
    ).body as { items: { number: string }[] };
    expect(found.items.map((i) => i.number)).toEqual(['EXP/26-27/102']);
  });

  it('keeps numbers already given when a series changes, and a series can become the default', async () => {
    const def = (await series()).items.find((x) => x.name === 'Tax invoices')!;
    await owner()
      .patch(`/number-series/${def.id}`, {
        prefix: 'NL-',
        suffix: '/{FY2}',
        digits: 3,
      })
      .expect(200);
    expect((await invoice('2026-06-01')).number).toBe('NL-003/26-27');
    const first = (
      await owner().get('/invoices?search=INV/2026-27/0001').expect(200)
    ).body as { items: { number: string }[] };
    expect(first.items).toHaveLength(1);
    // Another series becomes the default for drafts that don't choose
    const exp = (await series()).items.find((x) => x.name === 'Exports')!;
    await owner()
      .patch(`/number-series/${exp.id}`, { isDefault: true })
      .expect(200);
    expect((await invoice('2026-06-02')).number).toBe('EXP/26-27/103');
    const after = (await series()).items.filter((x) => x.type === 'invoice');
    expect(after.filter((x) => x.isDefault).map((x) => x.name)).toEqual([
      'Exports',
    ]);
    await owner()
      .patch(`/number-series/${def.id}`, { isDefault: true })
      .expect(200);
  });

  it('refuses series GST wouldn’t accept, and keeps one default', async () => {
    const bad = async (body: object, status: number, reason?: string) => {
      const r = await owner()
        .post('/number-series', {
          type: 'invoice',
          name: `X${randomUUID().slice(0, 4)}`,
          ...body,
        })
        .expect(status);
      if (reason) expect(r.body.details).toMatchObject({ reason });
    };
    await bad({ prefix: 'INVOICE/{FY}/' }, 400, 'too_long');
    await bad({ prefix: 'INV#' }, 400);
    await bad({ prefix: 'INV {FY}' }, 400);
    await bad({ prefix: 'A', digits: 2, startNumber: 500 }, 400, 'no_room');
    await bad({ name: 'exports' }, 409, 'name_taken');
    const def = (await series()).items.find(
      (x) => x.type === 'invoice' && x.isDefault,
    )!;
    expect(
      (
        await owner()
          .patch(`/number-series/${def.id}`, { archived: true })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'default_needed' });
    expect(
      (await owner().delete(`/number-series/${def.id}`).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'in_use' });
  });

  it('archives a used series instead of deleting it, and drafts can’t choose it', async () => {
    const exp = (await series()).items.find((x) => x.name === 'Exports')!;
    expect(exp.used).toBe(3);
    expect(
      (await owner().delete(`/number-series/${exp.id}`).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'in_use' });
    await owner()
      .patch(`/number-series/${exp.id}`, { archived: true })
      .expect(200);
    expect(
      (
        await owner()
          .post('/invoices', {
            contactId: customer,
            issueDate: '2026-06-03',
            seriesId: exp.id,
            lines: [
              {
                description: 'x',
                quantity: 1,
                unitPrice: 100,
                accountId: acc.sales,
              },
            ],
          })
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'invalid_series' });
    // An unused series is simply deleted
    const spare = (
      await owner()
        .post('/number-series', {
          type: 'credit_note',
          name: 'Spare',
          prefix: 'SP-',
        })
        .expect(201)
    ).body as Series;
    await owner().delete(`/number-series/${spare.id}`).expect(204);
  });

  it('keeps series to their organisation and their managers', async () => {
    const exp = (await series()).items.find((x) => x.name === 'Exports')!;
    await as('otherOwner', other)
      .patch(`/number-series/${exp.id}`, { name: 'Mine' })
      .expect(404);
    expect(
      (
        await as('otherOwner', other).get('/number-series').expect(200)
      ).body.items.map((x: Series) => x.id),
    ).not.toContain(exp.id);
    // Someone drafting invoices sees the series to choose from, but only managers change them
    await as('sales').get('/number-series').expect(200);
    await as('sales')
      .post('/number-series', { type: 'invoice', name: 'Sneaky' })
      .expect(403);
    await as('viewer').get('/number-series').expect(403);
    const otherSeries = (
      await as('otherOwner', other).get('/number-series').expect(200)
    ).body.items[0] as Series;
    expect(
      (
        await owner()
          .post('/invoices', {
            contactId: customer,
            issueDate: '2026-06-03',
            seriesId: otherSeries.id,
            lines: [
              {
                description: 'x',
                quantity: 1,
                unitPrice: 100,
                accountId: acc.sales,
              },
            ],
          })
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'invalid_series' });
  });

  it('numbers credit notes from their series and lists every series in GSTR-1 Table 13', async () => {
    const cnSeries = (await series()).items.find(
      (x) => x.type === 'credit_note',
    )!;
    await owner()
      .patch(`/number-series/${cnSeries.id}`, { prefix: 'CR-', digits: 2 })
      .expect(200);
    const inv = (await owner().get('/invoices?search=NL-003').expect(200)).body
      .items[0] as { id: string };
    const full = (await owner().get(`/invoices/${inv.id}`).expect(200))
      .body as Invoice;
    const note = (
      await owner()
        .post('/credit-notes', {
          invoiceId: full.id,
          date: '2026-06-05',
          reason: 'Returned',
          lines: [{ invoiceLineId: full.lines[0]!.id, quantity: '1' }],
        })
        .expect(201)
    ).body as { number: string };
    expect(note.number).toBe('CR-01');
    const g = (
      await owner()
        .get('/reports/gst/gstr-1?from=2026-04-01&to=2026-06-30')
        .expect(200)
    ).body as {
      docIssue: {
        type: string;
        series: string;
        from: string;
        to: string;
        total: number;
        cancelled: number;
      }[];
    };
    expect(g.docIssue).toEqual([
      {
        type: 'invoice',
        series: 'Exports',
        from: 'EXP/26-27/101',
        to: 'EXP/26-27/103',
        total: 3,
        cancelled: 0,
      },
      {
        type: 'invoice',
        series: 'Tax invoices',
        from: 'INV/2026-27/0001',
        to: 'NL-003/26-27',
        total: 3,
        cancelled: 0,
      },
      {
        type: 'credit_note',
        series: 'Credit notes',
        from: 'CR-01',
        to: 'CR-01',
        total: 1,
        cancelled: 0,
      },
    ]);
    const json = await owner().get(
      '/reports/gst/gstr-1/export?from=2026-04-01&to=2026-06-30&format=json',
    );
    if (json.status === 200) {
      const body = JSON.parse(json.text) as {
        doc_issue: {
          doc_det: { doc_num: number; docs: { totnum: number }[] }[];
        };
      };
      expect(
        body.doc_issue.doc_det.map((d) => [
          d.doc_num,
          d.docs.map((x) => x.totnum),
        ]),
      ).toEqual([
        [1, [3, 3]],
        [5, [1]],
      ]);
    }
  });

  it('writes the number onto documents numbered before series existed, e.g. from an older backup', async () => {
    const inv = (
      await owner().get('/invoices?search=INV/2026-27/0001').expect(200)
    ).body.items[0] as { id: string };
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { seriesId: null, fullNumber: null },
    });
    // It still reads the same, and is written down again the next time numbering runs
    expect(
      (await owner().get(`/invoices/${inv.id}`).expect(200)).body.number,
    ).toBe('INV/2026-27/0001');
    await series();
    expect(
      await prisma.invoice.findUnique({
        where: { id: inv.id },
        select: { fullNumber: true, seriesId: true },
      }),
    ).toMatchObject({
      fullNumber: 'INV/2026-27/0001',
      seriesId: expect.any(String),
    });
  });
});
