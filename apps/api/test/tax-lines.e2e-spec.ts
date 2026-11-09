import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Line = { lineNo: number; account: { code: string }; debit: number; credit: number; taxGroup: { name: string } | null; taxInclusive: boolean; taxRate: { name: string } | null; taxSourceLine: number | null };
type Entry = { id: string; number: string | null; lines: Line[]; totals: { debit: number; credit: number; difference: number } };

describe('Tax on journal lines (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, { id: string; token: string }> = {};
  const acc: Record<string, string> = {};
  const grp: Record<string, string> = {};
  let orgA = '';
  let orgB = '';
  let foreignGroup = '';

  const http = () => request(app.getHttpServer());
  const as = (who: string, org = orgA) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${users[who]!.token}`).set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
    };
  };
  type In = { a: string; dr?: number; cr?: number; tax?: string; incl?: boolean };
  const lines = (ls: In[]) => ls.map((l) => ({ accountId: acc[l.a], debit: l.dr ?? 0, credit: l.cr ?? 0, taxGroupId: l.tax ? grp[l.tax] : null, taxInclusive: l.incl ?? false }));
  const draft = async (date: string, ls: In[], memo = 'Test') => (await as('owner').post('/journals', { date, memo, lines: lines(ls) }).expect(201)).body as Entry;
  const post = async (id: string) => (await as('owner').post(`/journals/${id}/post`).expect(200)).body as Entry;
  const shape = (e: Entry) => e.lines.map((l) => [l.account.code, l.debit, l.credit, l.taxGroup?.name ?? l.taxRate?.name ?? null, l.taxSourceLine]);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    orgA = (await prisma.organization.create({ data: { name: `Tax lines A ${run}`, slug: `tax-lines-a-${run}`, country: 'IN', region: 'Maharashtra', fiscalYearStartMonth: 4 } })).id;
    orgB = (await prisma.organization.create({ data: { name: `Tax lines B ${run}`, slug: `tax-lines-b-${run}`, country: 'IN', region: 'Kerala' } })).id;
    for (const [key, org, role] of [
      ['owner', orgA, 'owner'],
      ['viewer', orgA, 'viewer'],
      ['ownerB', orgB, 'owner'],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused' } });
      await prisma.membership.create({ data: { userId: u.id, organizationId: org, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' }) };
    }
    for (const [key, code, type, subtype] of [
      ['bank', '1100', 'asset', 'bank'],
      ['sales', '4000', 'income', 'operating_income'],
      ['purchases', '5000', 'expense', 'cost_of_sales'],
    ] as const) {
      acc[key] = (await prisma.account.create({ data: { organizationId: orgA, code, name: `${key} ${run}`, type, subtype } })).id;
    }
    await as('owner').post('/fiscal-years', { startYear: 2026 }).expect(201);
    const setup = (await as('owner').post('/taxes/gst-setup').expect(200)).body as { groups: { id: string; name: string }[] };
    for (const g of setup.groups) grp[g.name] = g.id;
    foreignGroup = ((await as('ownerB', orgB).post('/taxes/gst-setup').expect(200)).body as { groups: { id: string }[] }).groups[0]!.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  it('adds CGST and SGST on top of an exclusive sale, each on its own line after the sale', async () => {
    const d = await draft('2026-05-05', [{ a: 'bank', dr: 118_000 }, { a: 'sales', cr: 100_000, tax: 'GST 18%' }], 'Sale within Maharashtra');
    expect(shape(d)).toEqual([
      ['1100', 118_000, 0, null, null],
      ['4000', 0, 100_000, 'GST 18%', null],
      ['2110', 0, 9_000, 'CGST 9%', 2],
      ['2120', 0, 9_000, 'SGST 9%', 2],
    ]);
    expect(d.totals.difference).toBe(0);
    expect((await post(d.id)).number).toBe('JV/2026-27/0001');
  });

  it('backs the tax out of an inclusive purchase and claims it as input credit', async () => {
    const d = await draft('2026-05-10', [{ a: 'purchases', dr: 11_800, tax: 'GST 18%', incl: true }, { a: 'bank', cr: 11_800 }], 'Stock bought');
    expect(shape(d)).toEqual([
      ['5000', 10_000, 0, 'GST 18%', null],
      ['1310', 900, 0, 'CGST 9%', 1],
      ['1320', 900, 0, 'SGST 9%', 1],
      ['1100', 0, 11_800, null, null],
    ]);
    expect(d.lines[0]!.taxInclusive).toBe(true);
    await post(d.id);
  });

  it('never loses a paisa when rounding an inclusive amount', async () => {
    const d = await draft('2026-05-11', [{ a: 'bank', dr: 101 }, { a: 'sales', cr: 101, tax: 'GST 18%', incl: true }]);
    const taxed = d.lines.filter((l) => l.account.code !== '1100').reduce((s, l) => s + l.credit, 0);
    expect(taxed).toBe(101);
    expect(d.totals.difference).toBe(0);
    await as('owner').patch(`/journals/${d.id}`, { date: '2026-05-11', lines: lines([{ a: 'bank', dr: 101 }, { a: 'sales', cr: 101, tax: 'GST 18%', incl: true }]) }).expect(200);
  });

  it('charges IGST on an inter-state sale, and nothing on a nil-rated one', async () => {
    const igst = await draft('2026-05-12', [{ a: 'bank', dr: 59_000 }, { a: 'sales', cr: 50_000, tax: 'IGST 18%' }], 'Sale to Karnataka');
    expect(shape(igst).slice(1)).toEqual([
      ['4000', 0, 50_000, 'IGST 18%', null],
      ['2130', 0, 9_000, 'IGST 18%', 2],
    ]);
    await post(igst.id);
    const nil = await draft('2026-05-13', [{ a: 'bank', dr: 20_000 }, { a: 'sales', cr: 20_000, tax: 'GST 0%' }], 'Fresh produce');
    expect(nil.lines).toHaveLength(2);
    await post(nil.id);
  });

  it('refuses archived groups and other organisations’ groups', async () => {
    await as('owner').post(`/taxes/groups/${grp['GST 40%']}/archive`).expect(200);
    const r = await as('owner').post('/journals', { date: '2026-05-14', lines: lines([{ a: 'bank', dr: 1_400 }, { a: 'sales', cr: 1_000, tax: 'GST 40%' }]) }).expect(400);
    expect(r.body.details.reason).toBe('tax_group_archived');
    await as('owner').post(`/taxes/groups/${grp['GST 40%']}/restore`).expect(200);
    const f = await as('owner').post('/journals', { date: '2026-05-14', lines: [{ accountId: acc.sales, credit: 1_000, taxGroupId: foreignGroup }] }).expect(400);
    expect(f.body.details.reason).toBe('tax_group_not_found');
    // Inclusive needs a group
    await as('owner').post('/journals', { date: '2026-05-14', lines: [{ accountId: acc.sales, credit: 1_000, taxInclusive: true }] }).expect(400);
  });

  it('posts a draft to the tax accounts as they are when it is posted', async () => {
    const d = await draft('2026-05-15', [{ a: 'bank', dr: 10_500 }, { a: 'sales', cr: 10_000, tax: 'GST 5%' }]);
    // The CGST 2.5% rate is pointed at a new output account after the draft was saved
    const newOut = (await prisma.account.create({ data: { organizationId: orgA, code: '2115', name: `CGST output new ${run}`, type: 'liability', subtype: 'tax_payable' } })).id;
    const cgst = await prisma.taxRate.findFirstOrThrow({ where: { organizationId: orgA, name: 'CGST 2.5%' } });
    await as('owner').patch(`/taxes/rates/${cgst.id}`, { outputAccountId: newOut }).expect(200);
    const p = await post(d.id);
    expect(p.lines.find((l) => l.taxRate?.name === 'CGST 2.5%')!.account.code).toBe('2115');
    expect(p.totals.difference).toBe(0);
  });

  it('a reversal mirrors the tax lines exactly', async () => {
    const d = await draft('2026-05-20', [{ a: 'bank', dr: 1_180 }, { a: 'sales', cr: 1_000, tax: 'GST 18%' }], 'Wrong sale');
    const posted = await post(d.id);
    const rev = (await as('owner').post(`/journals/${posted.id}/reverse`, { date: '2026-05-21' }).expect(201)).body as Entry;
    expect(shape(rev)).toEqual(shape(posted).map(([code, dr, cr, name, src]) => [code, cr, dr, name, src]));
  });

  it('the database refuses a tax line that names no source line', async () => {
    const d = await draft('2026-05-22', [{ a: 'bank', dr: 1 }]);
    const rate = await prisma.taxRate.findFirstOrThrow({ where: { organizationId: orgA, name: 'CGST 9%' } });
    await expect(prisma.$executeRaw`
      INSERT INTO journal_lines (id, organization_id, entry_id, line_no, account_id, debit, credit, tax_rate_id)
      VALUES (gen_random_uuid(), ${orgA}::uuid, ${d.id}::uuid, 9, ${acc.bank}::uuid, 1, 0, ${rate.id}::uuid)`).rejects.toThrow(/journal_lines_tax_shape/);
  });

  it('summarises taxable values and tax for filing, with credit notes and reversals netted', async () => {
    // A credit note: part of the first sale returned
    const cn = await draft('2026-05-25', [{ a: 'sales', dr: 10_000, tax: 'GST 18%' }, { a: 'bank', cr: 11_800 }], 'Credit note');
    expect(shape(cn)[1]).toEqual(['2110', 900, 0, 'CGST 9%', 1]);
    await post(cn.id);

    const t = (await as('viewer').get('/reports/tax-summary?from=2026-05-01&to=2026-05-31').expect(200)).body;
    const group = (name: string) => t.groups.find((g: { name: string }) => g.name === name);
    const rate = (name: string) => t.rates.find((r: { name: string }) => r.name === name);
    // 1,00,000 sold − 10,000 returned (the reversed sale nets to nothing; the 101-paisa sale is a draft)
    expect(group('GST 18%')).toMatchObject({ total: '18%', outward: { taxable: 90_000, tax: 16_200 }, inward: { taxable: 10_000, tax: 1_800 } });
    expect(group('IGST 18%')).toMatchObject({ outward: { taxable: 50_000, tax: 9_000 } });
    expect(group('GST 0%')).toMatchObject({ outward: { taxable: 20_000, tax: 0 } });
    expect(rate('CGST 9%')).toMatchObject({ output: 8_100, input: 900, net: 7_200 });
    expect(rate('IGST 18%')).toMatchObject({ output: 9_000, input: 0, net: 9_000 });
    expect(t.totals).toMatchObject({ output: 8_100 * 2 + 9_000 + 250 * 2, input: 1_800 });
    expect(t.totals.net).toBe(t.totals.output - t.totals.input);

    // April has nothing
    expect((await as('viewer').get('/reports/tax-summary?from=2026-04-01&to=2026-04-30').expect(200)).body).toMatchObject({ groups: [], rates: [] });
    await as('viewer').get('/reports/tax-summary?from=2026-05-31&to=2026-05-01').expect(400);
  });

  it('exports the summary as CSV for those allowed to export', async () => {
    await as('viewer').get('/reports/tax-summary/export?from=2026-05-01&to=2026-05-31').expect(403);
    const csv = await as('owner').get('/reports/tax-summary/export?from=2026-05-01&to=2026-05-31').expect(200);
    expect(csv.headers['content-disposition']).toContain('tax-summary-2026-05-01-2026-05-31.csv');
    expect(csv.text).toContain('"GST 18%","18%","900.00","162.00","100.00","18.00"');
    expect(csv.text).toContain('"CGST 9%","9%","81.00","9.00","72.00"');
  });

  it("other organisations see none of it", async () => {
    const b = (await as('ownerB', orgB).get('/reports/tax-summary?from=2026-05-01&to=2026-05-31').expect(200)).body;
    expect(b).toMatchObject({ groups: [], rates: [] });
  });
});
