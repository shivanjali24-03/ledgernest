import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
).toString('base64');
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString('base64');

describe('Document attachments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  let org = '';
  let bill = '';
  let rent = '';
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
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
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
          name: `Attach ${run}`,
          slug: `attach-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
    rent = (
      await as()
        .post('/accounts', {
          code: '5300',
          name: `Rent ${run}`,
          type: 'expense',
          subtype: 'operating_expense',
        })
        .expect(201)
    ).body.id;
    vendor = (
      await as()
        .post('/contacts', {
          name: 'Sharma Office Supplies',
          isCustomer: false,
          isVendor: true,
        })
        .expect(201)
    ).body.id;
    bill = (
      await as()
        .post('/bills', {
          contactId: vendor,
          billDate: '2026-05-04',
          lines: [
            {
              description: 'Rent',
              quantity: 1,
              unitPrice: 100,
              accountId: rent,
            },
          ],
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

  it('keeps a receipt with a bill, checked by its bytes, to preview or download', async () => {
    const list = (
      await as()
        .post(`/attachments/bill/${bill}`, {
          fileName: 'rent-receipt.pdf',
          type: 'application/pdf',
          data: pdf,
        })
        .expect(201)
    ).body as { id: string; fileName: string; size: number }[];
    expect(list).toEqual([
      expect.objectContaining({
        fileName: 'rent-receipt.pdf',
        contentType: 'application/pdf',
      }),
    ]);
    expect(
      (
        await as()
          .post(`/attachments/bill/${bill}`, {
            fileName: 'fake.png',
            type: 'image/png',
            data: pdf,
          })
          .expect(400)
      ).body.details.reason,
    ).toBe('type_mismatch');
    await as()
      .post(`/attachments/bill/${bill}`, {
        fileName: 'photo.png',
        type: 'image/png',
        data: png,
      })
      .expect(201);
    const preview = await as('auditor')
      .get(`/attachments/bill/${bill}/${list[0]!.id}?inline=true`)
      .expect(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(preview.headers['content-disposition']).toMatch(
      /^inline; filename="rent-receipt.pdf"/,
    );
    expect(
      (
        await as('auditor')
          .get(`/attachments/bill/${bill}/${list[0]!.id}`)
          .expect(200)
      ).headers['content-disposition'],
    ).toMatch(/^attachment;/);
  });

  it('takes files up to 2 MB, which are far bigger than an ordinary request', async () => {
    const big = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(1_900_000, 0x20),
    ]).toString('base64');
    const list = (
      await as()
        .post(`/attachments/bill/${bill}`, {
          fileName: 'scan.pdf',
          type: 'application/pdf',
          data: big,
        })
        .expect(201)
    ).body as { id: string; fileName: string; size: number }[];
    const scan = list.find((a) => a.fileName === 'scan.pdf')!;
    expect(scan.size).toBe(1_900_009);
    await as().delete(`/attachments/bill/${bill}/${scan.id}`).expect(204);
  });

  it('needs the document’s own permissions, and the organisation’s own document', async () => {
    expect(
      (await as('viewer').get(`/attachments/bill/${bill}`).expect(403)).body
        .details.missing,
    ).toEqual(['bills.view']);
    expect(
      (await as('auditor').get(`/attachments/bill/${bill}`).expect(200)).body,
    ).toHaveLength(2);
    await as('auditor')
      .post(`/attachments/bill/${bill}`, {
        fileName: 'x.pdf',
        type: 'application/pdf',
        data: pdf,
      })
      .expect(403);
    await as().get(`/attachments/bill/${randomUUID()}`).expect(404);
    await as().get(`/attachments/invoice/${bill}`).expect(404);
    await as().get(`/attachments/cheque/${bill}`).expect(400);
  });

  it('limits files per document, removes them, and audits it', async () => {
    for (let n = 0; n < 8; n++)
      await as()
        .post(`/attachments/bill/${bill}`, {
          fileName: `page-${n}.pdf`,
          type: 'application/pdf',
          data: pdf,
        })
        .expect(201);
    expect(
      (
        await as()
          .post(`/attachments/bill/${bill}`, {
            fileName: 'one-too-many.pdf',
            type: 'application/pdf',
            data: pdf,
          })
          .expect(409)
      ).body.details.reason,
    ).toBe('too_many');
    const [first] = (await as().get(`/attachments/bill/${bill}`).expect(200))
      .body as { id: string }[];
    await as().delete(`/attachments/bill/${bill}/${first!.id}`).expect(204);
    await as().delete(`/attachments/bill/${bill}/${first!.id}`).expect(404);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: org,
          action: { in: ['org.bill.attach', 'org.bill.detach'] },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.bill.attach', 'org.bill.detach']),
    );
    await as().delete(`/bills/${bill}`).expect(204);
    expect(
      await prisma.documentAttachment.count({ where: { organizationId: org } }),
    ).toBe(0);
  });
});
