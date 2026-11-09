import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

type Group = { id: string; name: string; supply: string | null; total: string; rates: { name: string; kind: string; rate: string }[]; gstSlab: { rate: string } | null };

describe('Taxes and GST (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  // A rate no other test uses, so reruns and parallel files never collide
  const testPpm = 2 * (100_000 + (parseInt(run.slice(0, 5), 16) % 100_000));
  const users: Record<string, { id: string; token: string }> = {};
  const org: Record<string, string> = {};
  const slabIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (who: string, o?: string) => {
    const auth = (r: request.Test) => {
      r.set('Authorization', `Bearer ${users[who]!.token}`);
      return o ? r.set('X-Organization-Id', o) : r;
    };
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) => auth(http().post(`/api/v1${p}`)).send(body),
      patch: (p: string, body: object) => auth(http().patch(`/api/v1${p}`)).send(body),
      delete: (p: string) => auth(http().delete(`/api/v1${p}`)),
    };
  };
  const pct = (ppm: number) => `${ppm / 10_000}%`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    for (const [key, country, region] of [
      ['mh', 'IN', 'Maharashtra'],
      ['ch', 'IN', 'Chandigarh'],
      ['uk', 'GB', null],
    ] as const) {
      org[key] = (await prisma.organization.create({ data: { name: `Taxes ${key} ${run}`, slug: `taxes-${key}-${run}`, country, region, baseCurrency: country === 'IN' ? 'INR' : 'GBP' } })).id;
    }
    for (const [key, o, role, sa] of [
      ['super', null, null, true],
      ['owner', org.mh, 'owner', false],
      ['viewer', org.mh, 'viewer', false],
      ['ownerCh', org.ch, 'owner', false],
      ['ownerUk', org.uk, 'owner', false],
    ] as const) {
      const u = await prisma.user.create({ data: { email: `${key}-${run}@test.ledgernest.local`, name: `User ${key}`, passwordHash: 'unused', isSuperAdmin: sa } });
      if (o && role) await prisma.membership.create({ data: { userId: u.id, organizationId: o, builtInRole: role } });
      users[key] = { id: u.id, token: await jwt.signAsync({ sub: u.id, sa }, { expiresIn: '15m' }) };
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: Object.values(org) } } });
    await prisma.gstSlab.deleteMany({ where: { id: { in: slabIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@test.ledgernest.local` } } });
    await app.close();
  });

  describe('GST slabs (Super Admin)', () => {
    it("starts with India's slabs after GST 2.0, keeping the retired ones for old entries", async () => {
      const slabs = (await as('super').get('/platform/gst-slabs').expect(200)).body as { rate: string; effectiveFrom: string; effectiveTo: string | null }[];
      const current = slabs.filter((s) => s.effectiveTo === null && s.effectiveFrom <= '2026-11-09').map((s) => s.rate);
      expect(current).toEqual(expect.arrayContaining(['0%', '0.25%', '3%', '5%', '18%', '40%']));
      expect(current).not.toContain('12%');
      expect(slabs.find((s) => s.rate === '28%')).toMatchObject({ effectiveTo: '2025-09-21' });
      expect(slabs.find((s) => s.rate === '40%')).toMatchObject({ effectiveFrom: '2025-09-22' });
    });

    it('only the Super Admin manages them', async () => {
      await as('owner').get('/platform/gst-slabs').expect(403);
      await as('owner').post('/platform/gst-slabs', { rate: pct(testPpm), label: 'Nope', effectiveFrom: '2099-01-01' }).expect(403);
    });

    it('adds a slab, refuses a second one in force at the same time, and retires it with an end date', async () => {
      const s = (await as('super').post('/platform/gst-slabs', { rate: pct(testPpm), label: 'Test slab', effectiveFrom: '2099-01-01' }).expect(201)).body;
      slabIds.push(s.id);
      expect(s).toMatchObject({ ratePpm: testPpm, effectiveTo: null, usage: 0 });

      const clash = await as('super').post('/platform/gst-slabs', { rate: pct(testPpm), label: 'Clash', effectiveFrom: '2099-06-01' }).expect(409);
      expect(clash.body.details).toMatchObject({ reason: 'overlap', slabId: s.id });

      await as('super').patch(`/platform/gst-slabs/${s.id}`, { effectiveTo: '2099-05-31', label: 'Test slab (old)' }).expect(200);
      const next = (await as('super').post('/platform/gst-slabs', { rate: pct(testPpm), label: 'Test slab (new)', effectiveFrom: '2099-06-01' }).expect(201)).body;
      slabIds.push(next.id);
      // Moving the old one's end past the new one's start would overlap
      expect((await as('super').patch(`/platform/gst-slabs/${s.id}`, { effectiveTo: '2099-06-15' }).expect(409)).body.details.reason).toBe('overlap');
      await as('super').patch(`/platform/gst-slabs/${s.id}`, { effectiveFrom: '2099-02-01', effectiveTo: '2099-01-01' }).expect(400);
      // Rates never change: there's no rate field to update
      await as('super').patch(`/platform/gst-slabs/${s.id}`, { rate: '20' }).expect(400);
      // A rate that can't be halved for CGST and SGST
      await as('super').post('/platform/gst-slabs', { rate: '0.0001', label: 'Odd', effectiveFrom: '2099-01-01' }).expect(400);

      const audit = await prisma.auditLog.findMany({ where: { entityId: s.id }, orderBy: { createdAt: 'asc' }, select: { action: true, organizationId: true } });
      expect(audit.map((a) => a.action)).toEqual(['platform.gst_slab.create', 'platform.gst_slab.update']);
      expect(audit[0]!.organizationId).toBeNull();

      await as('super').delete(`/platform/gst-slabs/${next.id}`).expect(204);
      slabIds.pop();
    });
  });

  describe('GST setup', () => {
    it('shows an Indian organisation its state and which slabs are set up', async () => {
      const t = (await as('viewer', org.mh).get('/taxes').expect(200)).body;
      expect(t.gst).toMatchObject({ state: { code: '27', name: 'Maharashtra' }, utgst: false });
      expect(t.gst.slabs.find((s: { rate: string; inForce: boolean }) => s.rate === '18%' && s.inForce)).toMatchObject({ setUp: false });
      expect(t.groups).toEqual([]);
      await as('viewer', org.mh).post('/taxes/gst-setup').expect(403);
    });

    it('creates the accounts, CGST + SGST groups for sales within the state and IGST groups for sales outside it', async () => {
      const r = (await as('owner', org.mh).post('/taxes/gst-setup').expect(200)).body;
      expect(r.created.accounts).toEqual(['1300 GST input tax credit', '1310 CGST input', '1320 SGST input', '1330 IGST input', '2100 GST payable', '2110 CGST output', '2120 SGST output', '2130 IGST output']);
      // Six slabs in force today, each with an intra-state and an inter-state group
      expect(r.created.groups).toHaveLength(12);
      const g = (name: string) => (r.groups as Group[]).find((x) => x.name === name)!;
      expect(g('GST 18%')).toMatchObject({ supply: 'intra', total: '18%', gstSlab: { rate: '18%' } });
      expect(g('GST 18%').rates.map((x) => [x.kind, x.rate])).toEqual([
        ['cgst', '9%'],
        ['sgst', '9%'],
      ]);
      expect(g('IGST 18%').rates.map((x) => [x.kind, x.rate])).toEqual([['igst', '18%']]);
      expect(g('GST 0.25%').rates.map((x) => x.rate)).toEqual(['0.125%', '0.125%']);
      expect(g('GST 40%').total).toBe('40%');
      expect((r.groups as Group[]).some((x) => x.name.includes('12%'))).toBe(false);

      const cgst9 = (r.rates as { name: string; outputAccount: { code: string }; inputAccount: { code: string } }[]).find((x) => x.name === 'CGST 9%')!;
      expect([cgst9.outputAccount.code, cgst9.inputAccount.code]).toEqual(['2110', '1310']);
      const out = await prisma.account.findFirstOrThrow({ where: { organizationId: org.mh, code: '2110' }, select: { type: true, parent: { select: { code: true } } } });
      expect(out).toEqual({ type: 'liability', parent: { code: '2100' } });
      expect(await prisma.auditLog.count({ where: { organizationId: org.mh, action: 'org.tax_setup.gst' } })).toBe(1);
    });

    it('running it again adds only what is missing, such as a retired slab for back-dated entries', async () => {
      const again = (await as('owner', org.mh).post('/taxes/gst-setup').expect(200)).body;
      expect(again.created).toMatchObject({ accounts: [], rates: [], groups: [] });

      const slabs = (await as('owner', org.mh).get('/taxes').expect(200)).body.gst.slabs as { id: string; rate: string; inForce: boolean }[];
      const old12 = slabs.find((s) => s.rate === '12%')!;
      expect(old12.inForce).toBe(false);
      const r = (await as('owner', org.mh).post('/taxes/gst-setup', { slabIds: [old12.id] }).expect(200)).body;
      expect(r.created.groups).toEqual(['GST 12% (to 2025-09-21)', 'IGST 12% (to 2025-09-21)']);
      expect(r.created.rates).toEqual(['CGST 6%', 'SGST 6%', 'IGST 12%']);
      await as('owner', org.mh).post('/taxes/gst-setup', { slabIds: [randomUUID()] }).expect(400);
    });

    it('charges UTGST instead of SGST in a Union Territory without a legislature', async () => {
      const r = (await as('ownerCh', org.ch).post('/taxes/gst-setup').expect(200)).body;
      expect(r.created.state).toBe('Chandigarh');
      expect(r.created.accounts).toContain('2140 UTGST output');
      expect(r.created.accounts).not.toContain('2120 SGST output');
      const gst5 = (r.groups as Group[]).find((x) => x.name === 'GST 5%')!;
      expect(gst5.rates.map((x) => `${x.kind} ${x.rate}`)).toEqual(['cgst 2.5%', 'utgst 2.5%']);
    });

    it('a slab an organisation uses can only be retired, not deleted', async () => {
      const slab18 = (await prisma.taxGroup.findFirstOrThrow({ where: { organizationId: org.mh, name: 'GST 18%' }, select: { gstSlabId: true } })).gstSlabId!;
      const r = await as('super').delete(`/platform/gst-slabs/${slab18}`).expect(409);
      expect(r.body.details.reason).toBe('in_use');
    });

    it('is for Indian organisations only', async () => {
      expect((await as('ownerUk', org.uk).post('/taxes/gst-setup').expect(409)).body.details.reason).toBe('not_india');
      expect((await as('ownerUk', org.uk).get('/taxes').expect(200)).body.gst).toBeNull();
    });
  });

  describe('rates and groups', () => {
    let vatPayable = '';
    let vatInput = '';
    let vat20 = '';
    let group = '';

    beforeAll(async () => {
      vatPayable = (await prisma.account.create({ data: { organizationId: org.uk, code: '2200', name: 'VAT payable', type: 'liability', subtype: 'tax_payable' } })).id;
      vatInput = (await prisma.account.create({ data: { organizationId: org.uk, code: '1400', name: 'VAT recoverable', type: 'asset', subtype: 'current_asset' } })).id;
    });

    it('creates a VAT rate posting to the right kinds of account', async () => {
      const bad = await as('ownerUk', org.uk).post('/taxes/rates', { name: 'VAT 20%', kind: 'vat', rate: '20', outputAccountId: vatInput }).expect(400);
      expect(bad.body.details.reason).toBe('output_not_liability');
      expect((await as('ownerUk', org.uk).post('/taxes/rates', { name: 'VAT 20%', kind: 'vat', rate: '20', outputAccountId: vatPayable, inputAccountId: vatPayable }).expect(400)).body.details.reason).toBe('same_account');
      const r = (await as('ownerUk', org.uk).post('/taxes/rates', { name: 'VAT 20%', kind: 'vat', rate: '20', outputAccountId: vatPayable, inputAccountId: vatInput }).expect(201)).body;
      vat20 = r.id;
      expect(r).toMatchObject({ rate: '20%', ratePpm: 200_000, outputAccount: { code: '2200' }, inputAccount: { code: '1400' } });
      expect((await as('ownerUk', org.uk).post('/taxes/rates', { name: 'vat 20%', kind: 'vat', rate: '20', outputAccountId: vatPayable }).expect(409)).body.details.reason).toBe('name_taken');
    });

    it("renames a rate but never changes its percentage", async () => {
      const renamed = (await as('ownerUk', org.uk).patch(`/taxes/rates/${vat20}`, { name: 'Standard VAT' }).expect(200)).body;
      // Renaming leaves the accounts alone
      expect(renamed).toMatchObject({ name: 'Standard VAT', outputAccount: { code: '2200' }, inputAccount: { code: '1400' } });
      await as('ownerUk', org.uk).patch(`/taxes/rates/${vat20}`, { rate: '17.5' }).expect(400);
    });

    it('groups rates, and archiving follows the dependencies', async () => {
      group = (await as('ownerUk', org.uk).post('/taxes/groups', { name: 'Standard rated', rateIds: [vat20] }).expect(201)).body.id;
      expect((await as('ownerUk', org.uk).post(`/taxes/rates/${vat20}/archive`).expect(409)).body.details.reason).toBe('in_active_group');
      await as('ownerUk', org.uk).post(`/taxes/groups/${group}/archive`).expect(200);
      await as('ownerUk', org.uk).post(`/taxes/rates/${vat20}/archive`).expect(200);
      expect((await as('ownerUk', org.uk).post(`/taxes/groups/${group}/restore`).expect(409)).body.details.reason).toBe('rate_archived');
      expect((await as('ownerUk', org.uk).post('/taxes/groups', { name: 'Another', rateIds: [vat20] }).expect(400)).body.details.reason).toBe('rate_archived');
      await as('ownerUk', org.uk).post(`/taxes/rates/${vat20}/restore`).expect(200);
      await as('ownerUk', org.uk).post(`/taxes/groups/${group}/restore`).expect(200);
      const actions = (await prisma.auditLog.findMany({ where: { organizationId: org.uk, action: { startsWith: 'org.tax_' } }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['org.tax_rate.create', 'org.tax_rate.update', 'org.tax_group.create', 'org.tax_group.archive', 'org.tax_rate.archive', 'org.tax_rate.restore', 'org.tax_group.restore']));
    });

    it('an account a tax rate posts to cannot be deleted or change type', async () => {
      expect((await as('ownerUk', org.uk).delete(`/accounts/${vatPayable}`).expect(409)).body.details.reason).toBe('used_by_tax');
      expect((await as('ownerUk', org.uk).patch(`/accounts/${vatInput}`, { type: 'expense', subtype: 'operating_expense' }).expect(409)).body.details.reason).toBe('used_by_tax');
    });

    it("other organisations can't see or change them", async () => {
      await as('owner', org.mh).patch(`/taxes/rates/${vat20}`, { name: 'Mine now' }).expect(404);
      await as('owner', org.mh).post(`/taxes/groups/${group}/archive`).expect(404);
      const mh = (await as('owner', org.mh).get('/taxes').expect(200)).body;
      expect(mh.rates.some((r: { id: string }) => r.id === vat20)).toBe(false);
      // A group can't borrow another organisation's rate either
      expect((await as('owner', org.mh).post('/taxes/groups', { name: 'Borrowed', rateIds: [vat20] }).expect(400)).body.details.reason).toBe('rate_not_found');
    });
  });
});
