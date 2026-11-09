import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Req = {
  id: string;
  documentType: string;
  documentId: string | null;
  amount: number;
  summary: string;
  status: string;
  note: string | null;
  requestedBy: { email: string };
};

describe('Approvals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let vendor = '';

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
      patch: (p: string, body: object) =>
        auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const draft = async (amount: number) =>
    (
      await as('maker')
        .post('/journals', {
          date: '2026-05-05',
          memo: `Rent ${amount}`,
          lines: [
            { accountId: acc.rent, debit: amount },
            { accountId: acc.bank, credit: amount },
          ],
        })
        .expect(201)
    ).body.id as string;
  const pending = async () =>
    (await as('checker').get('/approvals?status=pending').expect(200)).body as {
      items: Req[];
      pending: number;
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
          name: `Approvals ${run}`,
          slug: `approvals-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['maker', 'accountant'],
      ['checker', 'accountant'],
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
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2100', type: 'liability', subtype: 'accounts_payable' },
      ],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    vendor = (
      await as()
        .post('/contacts', {
          name: 'Sharma Office Supplies',
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

  it('lets owners and admins set the rules', async () => {
    await as('maker')
      .put('/approvals/rules/journal', { minAmount: 100_000_00 })
      .expect(403);
    const rules = (
      await as()
        .put('/approvals/rules/journal', { minAmount: 100_000_00 })
        .expect(200)
    ).body as {
      documentType: string;
      enabled: boolean;
      minAmount: number | null;
    }[];
    expect(rules).toEqual([
      expect.objectContaining({
        documentType: 'journal',
        enabled: true,
        minAmount: 100_000_00,
      }),
      expect.objectContaining({
        documentType: 'bill',
        enabled: false,
        minAmount: null,
      }),
      expect.objectContaining({ documentType: 'payment', enabled: false }),
      expect.objectContaining({ documentType: 'bank_spend', enabled: false }),
    ]);
    await as().put('/approvals/rules/cheque', { minAmount: 1 }).expect(400);
    await as('viewer').get('/approvals').expect(403);
  });

  it('posts below the limit, and holds an entry at or above it until someone else approves', async () => {
    await as('maker')
      .post(`/journals/${await draft(50_000_00)}/post`)
      .expect(200);
    const big = await draft(250_000_00);
    const held = (await as('maker').post(`/journals/${big}/post`).expect(409))
      .body.details;
    expect(held).toMatchObject({
      reason: 'approval_required',
      minAmount: 100_000_00,
    });
    expect(
      (await as('maker').post(`/journals/${big}/post`).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'approval_pending', requestId: held.requestId });
    expect(
      (await as('maker').get(`/journals/${big}`).expect(200)).body.status,
    ).toBe('draft');
    const list = await pending();
    expect(list.pending).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: held.requestId,
      documentType: 'journal',
      documentId: big,
      amount: 250_000_00,
      summary: 'Journal entry: Rent 25000000',
      status: 'pending',
    });
    expect(
      (
        await as('maker')
          .post(`/approvals/${held.requestId}/approve`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('own_request');
    // The checker's dashboard says something is waiting; the maker's doesn't (it's theirs)
    const alerts = async (who: string) =>
      (
        (await as(who).get('/reports/dashboard').expect(200)).body as {
          alerts: { kind: string; count: number }[];
        }
      ).alerts.filter((x) => x.kind === 'approvals_waiting');
    expect(await alerts('checker')).toEqual([
      { kind: 'approvals_waiting', count: 1 },
    ]);
    expect(await alerts('maker')).toEqual([]);
    const ok = (
      await as('checker')
        .post(`/approvals/${held.requestId}/approve`, {
          note: 'Matches the lease',
        })
        .expect(200)
    ).body as Req;
    expect(ok).toMatchObject({ status: 'approved', note: 'Matches the lease' });
    const posted = (await as('maker').get(`/journals/${big}`).expect(200)).body;
    expect(posted).toMatchObject({
      status: 'posted',
      postedBy: { email: `checker-${run}@test.ledgernest.local` },
    });
    expect(
      (
        await as('checker')
          .post(`/approvals/${held.requestId}/approve`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('already_decided');
  });

  it('refuses to approve an entry that changed after it was sent', async () => {
    const id = await draft(300_000_00);
    const { requestId } = (
      await as('maker').post(`/journals/${id}/post`).expect(409)
    ).body.details;
    await as('maker')
      .patch(`/journals/${id}`, {
        date: '2026-05-05',
        lines: [
          { accountId: acc.rent, debit: 400_000_00 },
          { accountId: acc.bank, credit: 400_000_00 },
        ],
      })
      .expect(200);
    expect(
      (
        await as('checker')
          .post(`/approvals/${requestId}/approve`, {})
          .expect(409)
      ).body.details.reason,
    ).toBe('document_changed');
    await as('checker')
      .post(`/approvals/${requestId}/reject`, { note: 'x' })
      .expect(400);
    expect(
      (
        await as('checker')
          .post(`/approvals/${requestId}/reject`, {
            note: 'Amount changed, send it again',
          })
          .expect(200)
      ).body,
    ).toMatchObject({
      status: 'rejected',
      note: 'Amount changed, send it again',
    });
    // Sent again: a new request
    const again = (await as('maker').post(`/journals/${id}/post`).expect(409))
      .body.details;
    expect(again.reason).toBe('approval_required');
    expect(again.requestId).not.toBe(requestId);
    await as('checker').delete(`/approvals/${again.requestId}`).expect(409);
    await as('maker').delete(`/approvals/${again.requestId}`).expect(204);
  });

  it('holds bills, and vendor payments as entered until approved', async () => {
    await as().put('/approvals/rules/bill', { minAmount: 0 }).expect(200);
    await as()
      .put('/approvals/rules/payment', { minAmount: 10_000_00 })
      .expect(200);
    const bill = (
      await as('maker')
        .post('/bills', {
          contactId: vendor,
          billDate: '2026-05-06',
          lines: [
            {
              description: 'Office rent, May',
              quantity: 1,
              unitPrice: 20_000_00,
              accountId: acc.rent,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    const b = (await as('maker').post(`/bills/${bill}/record`).expect(409)).body
      .details;
    expect(b.reason).toBe('approval_required');
    await as('checker')
      .post(`/approvals/${b.requestId}/approve`, {})
      .expect(200);
    expect(
      (await as('maker').get(`/bills/${bill}`).expect(200)).body.status,
    ).toBe('open');

    const p = (
      await as('maker')
        .post('/payments/payments', {
          contactId: vendor,
          date: '2026-05-07',
          bankAccountId: acc.bank,
          amount: 20_000_00,
          reference: 'NEFT 1',
          allocations: [{ billId: bill, amount: 20_000_00 }],
        })
        .expect(409)
    ).body.details;
    expect(p.reason).toBe('approval_required');
    expect((await as('maker').get('/payments').expect(200)).body.total).toBe(0);
    const ok = (
      await as('checker')
        .post(`/approvals/${p.requestId}/approve`, {})
        .expect(200)
    ).body as Req;
    expect(ok.documentId).toBeTruthy();
    expect(
      (await as('maker').get(`/bills/${bill}`).expect(200)).body.state,
    ).toBe('paid');
    // Below the payment limit: straight through
    await as('maker')
      .post('/payments/payments', {
        contactId: vendor,
        date: '2026-05-08',
        bankAccountId: acc.bank,
        amount: 5_000_00,
        allocations: [],
      })
      .expect(201);
  });

  it('holds money spent from the bank too, until someone else approves it', async () => {
    await as()
      .put('/approvals/rules/bank_spend', { minAmount: 10_000_00 })
      .expect(200);
    const spend = {
      kind: 'spend',
      bankAccountId: acc.bank,
      date: '2026-05-09',
      description: 'New laptops',
      lines: [{ accountId: acc.rent, amount: 50_000_00 }],
    };
    const held = (await as('maker').post('/banking/money', spend).expect(409))
      .body.details;
    expect(held.reason).toBe('approval_required');
    expect(
      (await as('maker').get('/banking/transactions').expect(200)).body.total,
    ).toBe(0);
    const ok = (
      await as('checker')
        .post(`/approvals/${held.requestId}/approve`, {})
        .expect(200)
    ).body as Req;
    expect(ok).toMatchObject({
      status: 'approved',
      documentType: 'bank_spend',
      summary: expect.stringMatching(/^Money spent from .*: New laptops$/),
    });
    expect(
      (await as('maker').get('/banking/transactions').expect(200)).body.total,
    ).toBe(1);
    // Under the limit, and money received, go straight through
    await as('maker')
      .post('/banking/money', {
        ...spend,
        lines: [{ accountId: acc.rent, amount: 5_000_00 }],
      })
      .expect(201);
    await as('maker')
      .post('/banking/money', {
        ...spend,
        kind: 'receive',
        lines: [{ accountId: acc.rent, amount: 50_000_00 }],
      })
      .expect(201);
  });

  it('audits requests and decisions', async () => {
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.approval.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.approval.rule',
        'org.approval.request',
        'org.approval.approve',
        'org.approval.reject',
        'org.approval.cancel',
      ]),
    );
  });
});
