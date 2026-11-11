import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  checkWebhookUrl,
  isPrivateAddress,
  postWebhook,
} from '../src/integrations/webhook-url.js';
import { WebhooksService } from '../src/integrations/webhooks.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Hit = {
  headers: Record<string, string | string[] | undefined>;
  body: string;
};
type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
};

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let server: Server;
  let url = '';
  let answer = 200;
  const hits: Hit[] = [];
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let kumar = '';

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
  const until = async (check: () => boolean | Promise<boolean>) => {
    for (let n = 0; n < 50 && !(await check()); n++)
      await new Promise((r) => setTimeout(r, 40));
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        hits.push({ headers: req.headers, body });
        res.statusCode = answer;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ledgernest`;
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
          name: `Hooks ${run}`,
          slug: `hooks-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['accountant', 'accountant'],
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
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
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
    server.close();
  });

  it('in production, never connects to a name that resolves to a private address', async () => {
    await expect(
      postWebhook('http://localhost:9/x', {}, '{}', true),
    ).rejects.toThrow(/private network/);
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('100.64.1.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('only lets webhooks point at https, or this machine outside production', () => {
    expect(() =>
      checkWebhookUrl('https://hooks.example.com/x', true),
    ).not.toThrow();
    expect(() => checkWebhookUrl('http://hooks.example.com/x', true)).toThrow(
      /https/,
    );
    expect(() => checkWebhookUrl('https://127.0.0.1/x', true)).toThrow(
      /private/,
    );
    expect(() => checkWebhookUrl('https://192.168.1.5/x', true)).toThrow(
      /private/,
    );
    expect(() => checkWebhookUrl('https://[::1]/x', true)).toThrow(/private/);
    // IPv4 written as IPv6, the unspecified address, and cloud metadata
    for (const u of [
      'https://[::ffff:127.0.0.1]/x',
      'https://[::ffff:a9fe:a9fe]/x',
      'https://[::]/x',
      'https://169.254.169.254/x',
      'https://0.0.0.0/x',
    ])
      expect(() => checkWebhookUrl(u, true), u).toThrow(/private/);
    expect(() =>
      checkWebhookUrl('https://user:pw@hooks.example.com/x', true),
    ).toThrow(/user name/);
    expect(() => checkWebhookUrl('http://127.0.0.1:9/x', false)).not.toThrow();
    expect(() => checkWebhookUrl('http://hooks.example.com/x', false)).toThrow(
      /https/,
    );
  });

  let hook = '';
  let secret = '';

  it('is set up by Owners and Admins, with the secret shown when made', async () => {
    await as('accountant')
      .post('/webhooks', { url, events: ['invoice.issued'] })
      .expect(403);
    await as()
      .post('/webhooks', { url, events: ['invoice.sent'] })
      .expect(400);
    const w = (
      await as()
        .post('/webhooks', {
          url,
          description: 'ERP',
          events: ['invoice.issued', 'invoice.voided'],
        })
        .expect(201)
    ).body as { id: string; secret: string };
    expect(w.secret).toMatch(/^whsec_/);
    hook = w.id;
    secret = w.secret;
    const list = (await as().get('/webhooks').expect(200)).body as {
      id: string;
      secret?: string;
    }[];
    expect(list[0]!.id).toBe(hook);
    expect(list[0]!.secret).toBeUndefined();
  });

  it('tells the endpoint when an invoice is issued, signed with its secret', async () => {
    const inv = (
      await as()
        .post('/invoices', {
          contactId: kumar,
          issueDate: '2026-05-04',
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice: 10_000_00,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    await as().post(`/invoices/${inv}/issue`).expect(200);
    await until(() => hits.length > 0);
    const hit = hits[0]!;
    expect(hit.headers['x-ledgernest-event']).toBe('invoice.issued');
    const body = JSON.parse(hit.body) as {
      id: string;
      event: string;
      data: { id: string; number: string; total: number };
    };
    expect(body).toMatchObject({
      event: 'invoice.issued',
      data: { id: inv, total: 10_000_00 },
    });
    expect(hit.headers['x-ledgernest-delivery']).toBe(body.id);
    const [t, v1] = String(hit.headers['x-ledgernest-signature'])
      .split(',')
      .map((p) => p.split('=')[1]!);
    expect(v1).toBe(
      createHmac('sha256', secret).update(`${t}.${hit.body}`).digest('hex'),
    );
    await until(
      async () =>
        (
          (await as().get(`/webhooks/${hook}/deliveries`).expect(200))
            .body as Delivery[]
        )[0]?.status === 'succeeded',
    );
    expect(
      (
        (await as().get(`/webhooks/${hook}/deliveries`).expect(200))
          .body as Delivery[]
      )[0],
    ).toMatchObject({
      event: 'invoice.issued',
      status: 'succeeded',
      attempts: 1,
      lastStatus: 200,
    });
  });

  it('retries a failed delivery later, keeping every attempt in the log', async () => {
    answer = 500;
    const ping = (await as().post(`/webhooks/${hook}/ping`).expect(200))
      .body as Delivery & { nextAttemptAt: string };
    expect(ping).toMatchObject({
      event: 'ping',
      status: 'pending',
      attempts: 1,
      lastStatus: 500,
      lastError: 'The endpoint answered 500.',
    });
    expect(new Date(ping.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    answer = 200;
    // Its time comes: the dispatcher picks it up
    await prisma.webhookDelivery.update({
      where: { id: ping.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await app.get(WebhooksService).dispatch();
    expect(
      await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: ping.id },
      }),
    ).toMatchObject({ status: 'succeeded', attempts: 2, lastStatus: 200 });
    // Given up after the last retry
    answer = 503;
    const again = (await as().post(`/webhooks/${hook}/ping`).expect(200))
      .body as Delivery;
    await prisma.webhookDelivery.update({
      where: { id: again.id },
      data: { attempts: 5 },
    });
    const last = (
      await as().post(`/webhooks/deliveries/${again.id}/retry`).expect(200)
    ).body as Delivery;
    expect(last).toMatchObject({
      status: 'failed',
      attempts: 6,
      lastStatus: 503,
    });
    answer = 200;
    expect(
      (await as().post(`/webhooks/deliveries/${again.id}/retry`).expect(200))
        .body,
    ).toMatchObject({ status: 'succeeded', attempts: 7 });
  });

  it('tells the endpoint about credit notes too, when it asks for them', async () => {
    await as()
      .patch(`/webhooks/${hook}`, {
        events: ['invoice.issued', 'credit_note.issued'],
      })
      .expect(200);
    const inv = (
      await as()
        .post('/invoices', {
          contactId: kumar,
          issueDate: '2026-05-06',
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice: 5_000_00,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    await as().post(`/invoices/${inv}/issue`).expect(200);
    const line = (
      (await as().get(`/invoices/${inv}`).expect(200)).body as {
        lines: { id: string }[];
      }
    ).lines[0]!.id;
    const before = hits.length;
    const note = (
      await as()
        .post('/credit-notes', {
          invoiceId: inv,
          date: '2026-05-07',
          reason: 'Late delivery',
          lines: [{ invoiceLineId: line, quantity: '1' }],
        })
        .expect(201)
    ).body as { id: string };
    await until(() =>
      hits
        .slice(before)
        .some((h) => h.headers['x-ledgernest-event'] === 'credit_note.issued'),
    );
    const hit = hits
      .slice(before)
      .find((h) => h.headers['x-ledgernest-event'] === 'credit_note.issued')!;
    expect(JSON.parse(hit.body)).toMatchObject({
      event: 'credit_note.issued',
      data: { id: note.id },
    });
  });

  it('tells the endpoint when a quote is accepted and invoiced', async () => {
    await as()
      .patch(`/webhooks/${hook}`, {
        events: ['quote.accepted', 'quote.invoiced'],
      })
      .expect(200);
    const quote = (
      await as()
        .post('/quotes', {
          contactId: kumar,
          quoteDate: '2026-05-08',
          expiryDate: '2026-06-07',
          lines: [
            {
              description: 'Freight',
              quantity: 2,
              unitPrice: 5_000_00,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    const before = hits.length;
    await as()
      .post(`/quotes/${quote.id}/status`, { status: 'accepted' })
      .expect(200);
    await as().post(`/quotes/${quote.id}/convert`, {}).expect(200);
    const events = () =>
      hits.slice(before).map((h) => h.headers['x-ledgernest-event']);
    await until(() => events().includes('quote.invoiced'));
    expect(events()).toEqual(
      expect.arrayContaining(['quote.accepted', 'quote.invoiced']),
    );
    const invoiced = hits
      .slice(before)
      .find((h) => h.headers['x-ledgernest-event'] === 'quote.invoiced')!;
    expect(JSON.parse(invoiced.body)).toMatchObject({
      event: 'quote.invoiced',
      data: { id: quote.id, status: 'invoiced', invoiceId: expect.any(String) },
    });
  });

  it('keeps finished deliveries for 30 days, and anything still waiting', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const base = {
      organizationId: org,
      endpointId: hook,
      event: 'ping',
      payload: {},
      createdAt: old,
    };
    const [done, waiting] = [randomUUID(), randomUUID()];
    await prisma.webhookDelivery.createMany({
      data: [
        { ...base, id: done, status: 'succeeded' },
        { ...base, id: waiting, status: 'pending' },
      ],
    });
    expect(await app.get(WebhooksService).prune()).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.webhookDelivery.findUnique({ where: { id: done } }),
    ).toBeNull();
    expect(
      await prisma.webhookDelivery.findUnique({ where: { id: waiting } }),
    ).not.toBeNull();
  });

  it('can be switched off, rotated and removed, and is audited', async () => {
    const before = hits.length;
    await as().patch(`/webhooks/${hook}`, { active: false }).expect(200);
    const inv = (
      await as()
        .post('/invoices', {
          contactId: kumar,
          issueDate: '2026-05-05',
          lines: [
            {
              description: 'Freight',
              quantity: 1,
              unitPrice: 100,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    await as().post(`/invoices/${inv}/issue`).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(hits.length).toBe(before);
    const { secret: next } = (
      await as().post(`/webhooks/${hook}/rotate`).expect(200)
    ).body as { secret: string };
    expect(next).not.toBe(secret);
    await as().delete(`/webhooks/${hook}`).expect(204);
    expect(
      await prisma.webhookDelivery.count({ where: { organizationId: org } }),
    ).toBe(0);
    const actions = (
      await prisma.auditLog.findMany({
        where: { organizationId: org, action: { startsWith: 'org.webhook.' } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'org.webhook.create',
        'org.webhook.update',
        'org.webhook.delete',
      ]),
    );
  });
});
