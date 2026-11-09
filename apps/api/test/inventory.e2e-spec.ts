import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Item = {
  id: string;
  stock: { onHand: string; value: number; averageCost: number | null } | null;
};
type Entry = {
  lines: { account: { code: string }; debit: number; credit: number }[];
};
type Movement = {
  id: string;
  kind: string;
  quantity: string;
  value: number;
  onHand: string;
  valueOnHand: number;
  undone: boolean;
  journalEntry: { id: string } | null;
};

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';
  let chair = '';

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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const stock = async () => {
    // What's on hand; whether it's low is checked on its own
    const { low: _low, ...rest } = (
      (await as().get(`/items/${chair}`).expect(200)).body as Item & {
        stock: { low: boolean };
      }
    ).stock;
    return rest;
  };
  const entry = async (id: string) =>
    ((await as().get(`/journals/${id}`).expect(200)).body as Entry).lines.map(
      (l) => [l.account.code, l.debit, l.credit],
    );

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
          name: `Stock ${run}`,
          slug: `stock-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['viewer', 'viewer'],
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
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['stock', { code: '1500', type: 'asset', subtype: 'inventory' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['capital', { code: '3100', type: 'equity', subtype: 'owner_equity' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['cogs', { code: '5000', type: 'expense', subtype: 'cost_of_sales' }],
      [
        'shrinkage',
        { code: '5100', type: 'expense', subtype: 'cost_of_sales' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    contact.kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    contact.sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Furniture',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('tracks stock only for goods, with an inventory and a cost of sales account', async () => {
    const reason = async (body: object) =>
      (
        await as()
          .post('/items', {
            name: `X ${randomUUID().slice(0, 4)}`,
            trackStock: true,
            ...body,
          })
          .expect(400)
      ).body.details.reason;
    expect(
      await reason({
        kind: 'service',
        inventoryAccountId: acc.stock,
        cogsAccountId: acc.cogs,
      }),
    ).toBe('not_goods');
    expect(await reason({ kind: 'goods', cogsAccountId: acc.cogs })).toBe(
      'inventory_account_required',
    );
    expect(
      await reason({
        kind: 'goods',
        inventoryAccountId: acc.sales,
        cogsAccountId: acc.cogs,
      }),
    ).toBe('inventory_account_type');
    const i = (
      await as()
        .post('/items', {
          name: 'Office chair',
          kind: 'goods',
          unit: 'nos',
          salePrice: 20_000,
          incomeAccountId: acc.sales,
          trackStock: true,
          inventoryAccountId: acc.stock,
          cogsAccountId: acc.cogs,
        })
        .expect(201)
    ).body as Item;
    chair = i.id;
    expect(i.stock).toEqual({ onHand: '0', value: 0, averageCost: null, low: false });
  });

  it('counts opening stock in against equity', async () => {
    expect(
      (
        await as()
          .post('/inventory/adjustments', {
            itemId: chair,
            date: '2026-04-01',
            direction: 'in',
            quantity: '10',
            accountId: acc.capital,
            reason: 'Opening stock',
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('unit_cost_required');
    const m = (
      await as()
        .post('/inventory/adjustments', {
          itemId: chair,
          date: '2026-04-01',
          direction: 'in',
          quantity: '10',
          unitCost: 10_000,
          accountId: acc.capital,
          reason: 'Opening stock',
        })
        .expect(201)
    ).body as Movement;
    expect(m).toMatchObject({
      kind: 'adjustment',
      quantity: '10',
      value: 100_000,
    });
    expect(await entry(m.journalEntry!.id)).toEqual([
      ['1500', 100_000, 0],
      ['3100', 0, 100_000],
    ]);
    expect(await stock()).toEqual({
      onHand: '10',
      value: 100_000,
      averageCost: 10_000,
    });
  });

  let bill = '';
  let invoice = '';

  it('buys stock on a bill into the inventory account, whatever account the line names', async () => {
    const b = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          billDate: '2026-05-02',
          lines: [
            {
              itemId: chair,
              description: 'Office chair',
              quantity: 5,
              unitPrice: 13_000,
              accountId: acc.cogs,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    bill = b.id;
    const r = (await as().post(`/bills/${bill}/record`).expect(200)).body as {
      journalEntry: { id: string };
    };
    expect(await entry(r.journalEntry.id)).toEqual([
      ['1500', 65_000, 0],
      ['2100', 0, 65_000],
    ]);
    expect(await stock()).toEqual({
      onHand: '15',
      value: 165_000,
      averageCost: 11_000,
    });
  });

  it('sells at average cost, posting it to cost of sales, and refuses to sell what isn’t there', async () => {
    const i = (
      await as()
        .post('/invoices', {
          contactId: contact.kumar,
          issueDate: '2026-05-10',
          lines: [
            {
              itemId: chair,
              description: 'Office chair',
              quantity: 6,
              unitPrice: 20_000,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    invoice = i.id;
    const r = (await as().post(`/invoices/${invoice}/issue`).expect(200))
      .body as { journalEntry: { id: string } };
    expect(await entry(r.journalEntry.id)).toEqual([
      ['1300', 120_000, 0],
      ['4100', 0, 120_000],
      ['5000', 66_000, 0],
      ['1500', 0, 66_000],
    ]);
    expect(await stock()).toEqual({
      onHand: '9',
      value: 99_000,
      averageCost: 11_000,
    });
    const big = (
      await as()
        .post('/invoices', {
          contactId: contact.kumar,
          issueDate: '2026-05-11',
          lines: [
            {
              itemId: chair,
              description: 'Office chair',
              quantity: 20,
              unitPrice: 20_000,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    const refused = (await as().post(`/invoices/${big.id}/issue`).expect(409))
      .body;
    expect(refused.details).toMatchObject({
      reason: 'insufficient_stock',
      onHand: '9',
    });
    expect(
      (await as().get(`/invoices/${big.id}`).expect(200)).body.status,
    ).toBe('draft');
  });

  let writeOff = '';

  it('writes stock off with a reason, and values it beside the books', async () => {
    const m = (
      await as()
        .post('/inventory/adjustments', {
          itemId: chair,
          date: '2026-05-20',
          direction: 'out',
          quantity: '1',
          accountId: acc.shrinkage,
          reason: 'Damaged in the warehouse',
        })
        .expect(201)
    ).body as Movement;
    writeOff = m.id;
    expect(m).toMatchObject({
      quantity: '-1',
      value: -11_000,
      onHand: '8',
      valueOnHand: 88_000,
    });
    const v = (
      await as('viewer').get('/inventory/valuation?asOf=2026-05-31').expect(200)
    ).body as {
      total: number;
      rows: { name: string; quantity: string; averageCost: number }[];
      accounts: { code: string; stock: number; ledger: number }[];
    };
    expect(v.total).toBe(88_000);
    expect(v.rows).toEqual([
      expect.objectContaining({
        name: 'Office chair',
        quantity: '8',
        averageCost: 11_000,
      }),
    ]);
    expect(v.accounts).toEqual([
      expect.objectContaining({ code: '1500', stock: 88_000, ledger: 88_000 }),
    ]);
    expect(
      (
        await as('viewer')
          .get('/inventory/valuation?asOf=2026-04-30')
          .expect(200)
      ).body.total,
    ).toBe(100_000);
    expect(
      (
        await as()
          .post(`/journals/${m.journalEntry!.id}/reverse`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('document_entry');
    await as('viewer')
      .post('/inventory/adjustments', {
        itemId: chair,
        date: '2026-05-20',
        direction: 'out',
        quantity: '1',
        accountId: acc.shrinkage,
        reason: 'Nope',
      })
      .expect(403);
  });

  it('puts stock back when an invoice or bill is voided, or an adjustment undone', async () => {
    await as()
      .post(`/invoices/${invoice}/void`, {
        date: '2026-05-25',
        reason: 'Returned',
      })
      .expect(200);
    expect(await stock()).toEqual({
      onHand: '14',
      value: 154_000,
      averageCost: 11_000,
    });
    await as().post(`/bills/${bill}/void`, { date: '2026-05-26' }).expect(200);
    expect(await stock()).toEqual({
      onHand: '9',
      value: 89_000,
      averageCost: 9_889,
    });
    await as().delete(`/inventory/adjustments/${writeOff}`).expect(204);
    expect(
      (await as().delete(`/inventory/adjustments/${writeOff}`).expect(409)).body
        .details.reason,
    ).toBe('already_undone');
    expect(await stock()).toEqual({
      onHand: '10',
      value: 100_000,
      averageCost: 10_000,
    });
    const list = (
      (await as().get(`/inventory/items/${chair}/movements`).expect(200))
        .body as { movements: Movement[] }
    ).movements;
    expect(list.map((m) => m.kind)).toEqual([
      'adjustment',
      'bill',
      'invoice',
      'adjustment',
      'invoice_void',
      'bill_void',
      'adjustment_undo',
    ]);
    expect(list.find((m) => m.id === writeOff)!.undone).toBe(true);
  });

  it('keeps tracking fixed once stock has moved, and audits adjustments', async () => {
    expect(
      (await as().patch(`/items/${chair}`, { trackStock: false }).expect(409))
        .body.details.reason,
    ).toBe('stock_moved');
    expect(
      (await as().delete(`/items/${chair}`).expect(409)).body.details.reason,
    ).toBe('in_use');
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.stock.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.stock.adjust', 'org.stock.adjust_undo']),
    );
  });

  it('takes goods back on a credit note at the cost they left at, and out again if it’s voided', async () => {
    const inv = (
      await as()
        .post('/invoices', {
          contactId: contact.kumar,
          issueDate: '2026-06-01',
          lines: [
            {
              itemId: chair,
              description: 'Office chair',
              quantity: 4,
              unitPrice: 20_000,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    await as().post(`/invoices/${inv.id}/issue`).expect(200);
    expect(await stock()).toEqual({
      onHand: '6',
      value: 60_000,
      averageCost: 10_000,
    });
    const line = (
      (await as().get(`/invoices/${inv.id}`).expect(200)).body as {
        lines: { id: string }[];
      }
    ).lines[0]!.id;
    // A price correction: no goods back
    await as()
      .post('/credit-notes', {
        invoiceId: inv.id,
        date: '2026-06-02',
        reason: 'Discount agreed',
        lines: [{ invoiceLineId: line, quantity: '1' }],
      })
      .expect(201);
    expect(await stock()).toEqual({
      onHand: '6',
      value: 60_000,
      averageCost: 10_000,
    });
    const back = (
      await as()
        .post('/credit-notes', {
          invoiceId: inv.id,
          date: '2026-06-03',
          reason: 'One came back damaged in transit',
          returnsStock: true,
          lines: [{ invoiceLineId: line, quantity: '1' }],
        })
        .expect(201)
    ).body as { id: string; journalEntry: { id: string } };
    expect(await stock()).toEqual({
      onHand: '7',
      value: 70_000,
      averageCost: 10_000,
    });
    expect(await entry(back.journalEntry.id)).toEqual(
      expect.arrayContaining([
        ['1500', 10_000, 0],
        ['5000', 0, 10_000],
      ]),
    );
    const list = (
      (await as().get(`/inventory/items/${chair}/movements`).expect(200))
        .body as {
        movements: (Movement & {
          document: { number: string | null } | null;
        })[];
      }
    ).movements;
    expect(list.find((m) => m.kind === 'credit_note')).toMatchObject({
      kind: 'credit_note',
      quantity: '1',
      value: 10_000,
      document: { number: expect.stringMatching(/^CN\//) },
    });
    await as()
      .post(`/credit-notes/${back.id}/void`, { date: '2026-06-04' })
      .expect(200);
    expect(await stock()).toEqual({
      onHand: '6',
      value: 60_000,
      averageCost: 10_000,
    });
  });

  it('flags goods at or below their reorder level, on the item, the valuation and the dashboard', async () => {
    const low = async () =>
      (
        (await as().get('/reports/dashboard').expect(200)).body as {
          alerts: { kind: string; count: number }[];
        }
      ).alerts.find((a) => a.kind === 'low_stock');
    expect(await low()).toBeUndefined();
    await as().patch(`/items/${chair}`, { reorderLevel: '6' }).expect(200);
    expect(
      (await as().get(`/items/${chair}`).expect(200)).body as {
        reorderLevel: string;
        stock: { low: boolean };
      },
    ).toMatchObject({ reorderLevel: '6', stock: { low: true } });
    expect(
      (
        (await as().get('/inventory/valuation').expect(200)).body as {
          rows: { reorderLevel: string; low: boolean }[];
        }
      ).rows[0],
    ).toMatchObject({ reorderLevel: '6', low: true });
    expect(await low()).toEqual({ kind: 'low_stock', count: 1 });
    await as().patch(`/items/${chair}`, { reorderLevel: '5' }).expect(200);
    expect(await low()).toBeUndefined();
    await as()
      .patch(`/items/${chair}`, { reorderLevel: '5.12345' })
      .expect(400);
  });
});
