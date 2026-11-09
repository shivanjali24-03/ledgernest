import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { BackupFile } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Tb = {
  rows: {
    code: string;
    debit: number;
    credit: number;
    balanceDebit: number;
    balanceCredit: number;
  }[];
  totals: { debit: number; credit: number };
};
const pdf = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');

describe('Backups (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let restored = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner', orgId?: string) => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]!.token}`)
        .set('X-Organization-Id', orgId ?? org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };
  const journal = async (date: string, lines: [string, number, number][]) => {
    const d = await as()
      .post('/journals', {
        date,
        memo: `Entry ${date}`,
        lines: lines.map(([a, debit, credit]) => ({
          accountId: acc[a],
          debit,
          credit,
        })),
      })
      .expect(201);
    await as().post(`/journals/${d.body.id}/post`).expect(200);
    return d.body.id as string;
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
          name: `Backup Co ${run}`,
          slug: `backup-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          legalName: 'Backup Co Pvt Ltd',
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['admin', 'admin'],
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
    acc.banks = (
      await as()
        .post('/accounts', {
          code: '1100',
          name: 'Banks',
          type: 'asset',
          subtype: 'bank',
        })
        .expect(201)
    ).body.id;
    acc.hdfc = (
      await as()
        .post('/accounts', {
          code: '1100.01',
          name: 'HDFC',
          type: 'asset',
          subtype: 'bank',
          parentId: acc.banks,
        })
        .expect(201)
    ).body.id;
    for (const [key, body] of [
      [
        'debtors',
        { code: '1300', type: 'asset', subtype: 'accounts_receivable' },
      ],
      ['capital', { code: '3100', type: 'equity', subtype: 'owner_equity' }],
      ['sales', { code: '4100', type: 'income', subtype: 'operating_income' }],
      ['rent', { code: '5300', type: 'expense', subtype: 'operating_expense' }],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    await journal('2026-04-02', [
      ['hdfc', 500_000_00, 0],
      ['capital', 0, 500_000_00],
    ]);
    const wrong = await journal('2026-04-10', [
      ['rent', 30_000_00, 0],
      ['hdfc', 0, 30_000_00],
    ]);
    await as().post(`/journals/${wrong}/reverse`, {}).expect(201);
    const kumar = (
      await as()
        .post('/contacts', {
          name: 'Kumar Logistics',
          isCustomer: true,
          isVendor: false,
        })
        .expect(201)
    ).body.id;
    const inv = (
      await as()
        .post('/invoices', {
          contactId: kumar,
          issueDate: '2026-05-05',
          lines: [
            {
              description: 'Freight',
              quantity: 2,
              unitPrice: 25_000_00,
              accountId: acc.sales,
            },
          ],
        })
        .expect(201)
    ).body.id;
    await as().post(`/invoices/${inv}/issue`).expect(200);
    await as()
      .post(`/attachments/invoice/${inv}`, {
        fileName: 'po.pdf',
        type: 'application/pdf',
        data: pdf,
      })
      .expect(201);
    // April closed
    const years = (await as().get('/fiscal-years').expect(200)).body as {
      years: { periods: { id: string; number: number }[] }[];
    };
    await as()
      .post(
        `/fiscal-years/periods/${years.years[0]!.periods.find((p) => p.number === 1)!.id}/close`,
      )
      .expect(204);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [org, restored].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let backup: BackupFile;

  it('exports the whole organisation as one file, for Owners only', async () => {
    await as('admin').get('/backups/export').expect(403);
    const res = await as().get('/backups/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="backup-co-[a-z0-9]+-backup-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    backup = res.body as BackupFile;
    expect(backup).toMatchObject({
      format: 'ledgernest-backup',
      version: 1,
      source: { organizationId: org },
    });
    expect(backup.organization).toMatchObject({
      legal_name: 'Backup Co Pvt Ltd',
      fiscal_year_start_month: 4,
    });
    expect(Object.keys(backup.tables)).toEqual(
      expect.arrayContaining([
        'accounts',
        'journal_entries',
        'journal_lines',
        'invoices',
        'invoice_lines',
        'contacts',
        'periods',
        'fiscal_years',
        'document_attachments',
      ]),
    );
    expect(backup.tables.memberships).toBeUndefined();
    expect(backup.tables.audit_logs).toBeUndefined();
    expect(typeof backup.tables.journal_lines![0]!.debit).toBe('string');
  });

  it('refuses a file that doesn’t hold together, writing nothing', async () => {
    const before = await prisma.organization.count();
    const broken = structuredClone(backup);
    broken.tables.journal_lines = broken.tables.journal_lines!.slice(1);
    expect(
      (await as().post('/backups/restore', { backup: broken }).expect(400)).body
        .details,
    ).toMatchObject({ reason: 'backup_invalid' });
    const dangling = structuredClone(backup);
    dangling.tables.accounts = dangling.tables.accounts!.filter(
      (a) => a.code !== '1100',
    );
    expect(
      (await as().post('/backups/restore', { backup: dangling }).expect(400))
        .body.details.problems,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/accounts point to missing accounts/),
      ]),
    );
    await as()
      .post('/backups/restore', {
        backup: { ...backup, format: 'something-else' },
      })
      .expect(400);
    await as('admin').post('/backups/restore', { backup }).expect(403);
    expect(await prisma.organization.count()).toBe(before);
  });

  it('restores into a new organisation with new ids and the same books', async () => {
    const r = (
      await as()
        .post('/backups/restore', { backup, name: `Restored ${run}` })
        .expect(201)
    ).body as { organizationId: string; name: string };
    restored = r.organizationId;
    expect(restored).not.toBe(org);
    expect(r.name).toBe(`Restored ${run}`);
    const tb = async (o: string) =>
      (
        (
          await as('owner', o)
            .get('/reports/trial-balance?asOf=2027-03-31')
            .expect(200)
        ).body as Tb
      ).rows.map((x) => [x.code, x.balanceDebit, x.balanceCredit]);
    expect(await tb(restored)).toEqual(await tb(org));
    const ids = await prisma.account.findMany({
      where: { organizationId: restored },
      select: { id: true, code: true, parent: { select: { code: true } } },
    });
    expect(ids.find((a) => a.code === '1100.01')!.parent!.code).toBe('1100');
    expect(
      ids.some((a) => backup.tables.accounts!.some((b) => b.id === a.id)),
    ).toBe(false);
    // Posted entries are posted, with their reversal link; April is closed again
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: restored },
      select: { status: true, reversalOfId: true },
    });
    expect(entries.filter((e) => e.status === 'posted')).toHaveLength(4);
    expect(entries.filter((e) => e.reversalOfId)).toHaveLength(1);
    const periods = await prisma.period.findMany({
      where: { organizationId: restored },
      orderBy: { number: 'asc' },
      select: { number: true, status: true },
    });
    expect(periods[0]).toMatchObject({ number: 1, status: 'closed' });
    expect(periods[1]).toMatchObject({ status: 'open' });
    // The invoice, its number and its attachment came along, pointing at the new invoice
    const inv = await prisma.invoice.findFirstOrThrow({
      where: { organizationId: restored },
      select: { id: true, number: true, total: true },
    });
    expect(inv).toMatchObject({ number: 1, total: 50_000_00n });
    const file = await prisma.documentAttachment.findFirstOrThrow({
      where: { organizationId: restored },
      select: { documentId: true, data: true },
    });
    expect(file.documentId).toBe(inv.id);
    expect(Buffer.from(file.data).toString('base64')).toBe(pdf);
    // The restorer owns it; nobody else came along
    expect(
      await prisma.membership.findMany({
        where: { organizationId: restored },
        select: { userId: true, builtInRole: true },
      }),
    ).toEqual([{ userId: users.owner!.id, builtInRole: 'owner' }]);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          organizationId: { in: [org, restored] },
          action: { startsWith: 'org.backup.' },
        },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['org.backup.export', 'org.backup.restore']),
    );
  });
});
