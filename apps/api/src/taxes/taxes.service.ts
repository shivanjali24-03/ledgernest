import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TEMPLATE_ACCOUNT_NAMES,
  UTGST_ACCOUNT_NAMES,
  findIndianState,
  formatRate,
  gstAccountPlan,
  slabInForce,
  templateLanguage,
  todayIn,
  type TaxKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GstSlabsService } from './gst-slabs.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const rateSelect = {
  id: true,
  name: true,
  kind: true,
  ratePpm: true,
  outputAccountId: true,
  inputAccountId: true,
  archivedAt: true,
  outputAccount: { select: { id: true, code: true, name: true } },
  inputAccount: { select: { id: true, code: true, name: true } },
  _count: { select: { groups: true } },
} as const;
type RateRow = Prisma.TaxRateGetPayload<{ select: typeof rateSelect }>;

const groupSelect = {
  id: true,
  name: true,
  supply: true,
  archivedAt: true,
  gstSlab: { select: { id: true, ratePpm: true, label: true, effectiveFrom: true, effectiveTo: true } },
  rates: { orderBy: { position: 'asc' as const }, select: { rate: { select: { id: true, name: true, kind: true, ratePpm: true, archivedAt: true } } } },
} as const;
type GroupRow = Prisma.TaxGroupGetPayload<{ select: typeof groupSelect }>;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * An organisation's tax rates and groups. Rates hold a percentage and the accounts it posts to;
 * groups bundle rates and are what a line picks. Percentages never change once created, because
 * entries were taxed at them: a new rate is a new rate.
 */
@Injectable()
export class TaxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'taxes:' + organizationId}))`;
  }

  /** Taxes also create accounts, so they take the chart of accounts' lock too (always in this order). */
  private lockAccounts(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'accounts:' + organizationId}))`;
  }

  private rateView(r: RateRow) {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as TaxKind,
      ratePpm: r.ratePpm,
      rate: formatRate(r.ratePpm),
      outputAccount: r.outputAccount,
      inputAccount: r.inputAccount,
      archived: !!r.archivedAt,
      groupCount: r._count.groups,
    };
  }

  private groupView(g: GroupRow) {
    const rates = g.rates.map(({ rate }) => ({ id: rate.id, name: rate.name, kind: rate.kind as TaxKind, ratePpm: rate.ratePpm, rate: formatRate(rate.ratePpm), archived: !!rate.archivedAt }));
    const totalPpm = rates.reduce((s, r) => s + r.ratePpm, 0);
    return {
      id: g.id,
      name: g.name,
      supply: g.supply as 'intra' | 'inter' | null,
      gstSlab: g.gstSlab && { id: g.gstSlab.id, rate: formatRate(g.gstSlab.ratePpm), label: g.gstSlab.label, effectiveFrom: iso(g.gstSlab.effectiveFrom), effectiveTo: g.gstSlab.effectiveTo && iso(g.gstSlab.effectiveTo) },
      archived: !!g.archivedAt,
      totalPpm,
      total: formatRate(totalPpm),
      rates,
    };
  }

  /** Rates and groups (active first), and for Indian organisations how GST is set up. */
  async list(organizationId: string) {
    const [org, rates, groups] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { country: true, region: true, timeZone: true } }),
      this.prisma.taxRate.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { kind: 'asc' }, { ratePpm: 'asc' }, { name: 'asc' }], select: rateSelect }),
      this.prisma.taxGroup.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }], select: groupSelect }),
    ]);
    const views = groups.map((g) => this.groupView(g));
    views.sort((a, b) => Number(a.archived) - Number(b.archived) || a.totalPpm - b.totalPpm || (a.supply ?? '').localeCompare(b.supply ?? '') || a.name.localeCompare(b.name));
    return { rates: rates.map((r) => this.rateView(r)), groups: views, gst: org.country === 'IN' ? await this.gstStatus(organizationId, org) : null };
  }

  private async gstStatus(organizationId: string, org: { region: string | null; timeZone: string }) {
    const state = findIndianState(org.region);
    const today = todayIn(org.timeZone);
    const [slabs, made] = await Promise.all([
      this.prisma.gstSlab.findMany({ orderBy: [{ ratePpm: 'asc' }, { effectiveFrom: 'desc' }] }),
      this.prisma.taxGroup.findMany({ where: { organizationId, gstSlabId: { not: null } }, select: { gstSlabId: true, supply: true } }),
    ]);
    const done = new Set(made.map((g) => `${g.gstSlabId}:${g.supply}`));
    return {
      state: state && { code: state.code, name: state.name },
      /** Union Territories without a legislature charge UTGST instead of SGST */
      utgst: state?.utgst ?? false,
      slabs: slabs.map((s) => {
        const v = GstSlabsService.view(s);
        return { ...v, inForce: slabInForce(v, today), setUp: done.has(`${s.id}:intra`) && done.has(`${s.id}:inter`) };
      }),
    };
  }

  // ---------- rates ----------

  private async findRate(tx: Tx | PrismaService, organizationId: string, id: string) {
    const r = await tx.taxRate.findFirst({ where: { id, organizationId }, select: rateSelect });
    if (!r) throw new NotFoundException('Tax rate not found.');
    return r;
  }

  /** Output tax is owed (a liability); input tax is claimable (an asset). Both must be active accounts here. */
  private async checkAccounts(tx: Tx, organizationId: string, outputAccountId: string, inputAccountId: string | null) {
    const ids = [outputAccountId, ...(inputAccountId ? [inputAccountId] : [])];
    const found = await tx.account.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, type: true, archivedAt: true } });
    const output = found.find((a) => a.id === outputAccountId);
    if (!output) throw refuse(BadRequestException, 'The tax account doesn’t exist.', 'account_not_found', { field: 'outputAccountId' });
    if (output.type !== 'liability') throw refuse(BadRequestException, 'Tax on sales goes to a liability account.', 'output_not_liability', { field: 'outputAccountId' });
    if (output.archivedAt) throw refuse(BadRequestException, 'That account is archived.', 'account_archived', { field: 'outputAccountId' });
    if (inputAccountId) {
      if (inputAccountId === outputAccountId) throw refuse(BadRequestException, 'Use different accounts for tax on sales and on purchases.', 'same_account', { field: 'inputAccountId' });
      const input = found.find((a) => a.id === inputAccountId);
      if (!input) throw refuse(BadRequestException, 'The input tax account doesn’t exist.', 'account_not_found', { field: 'inputAccountId' });
      if (input.type !== 'asset') throw refuse(BadRequestException, 'Tax on purchases goes to an asset account (input credit).', 'input_not_asset', { field: 'inputAccountId' });
      if (input.archivedAt) throw refuse(BadRequestException, 'That account is archived.', 'account_archived', { field: 'inputAccountId' });
    }
  }

  private async assertRateName(tx: Tx, organizationId: string, name: string, exceptId?: string) {
    if (await tx.taxRate.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) }, select: { id: true } })) {
      throw refuse(ConflictException, 'Another tax rate already has this name.', 'name_taken');
    }
  }

  async createRate(input: { name: string; kind: TaxKind; rate: number; outputAccountId: string; inputAccountId: string | null }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.assertRateName(tx, organizationId, input.name);
      await this.checkAccounts(tx, organizationId, input.outputAccountId, input.inputAccountId);
      const r = await tx.taxRate.create({ data: { organizationId, name: input.name, kind: input.kind, ratePpm: input.rate, outputAccountId: input.outputAccountId, inputAccountId: input.inputAccountId }, select: rateSelect });
      await this.audit.record({ action: 'org.tax_rate.create', actorId: ctx.actor.userId, organizationId, entityType: 'tax_rate', entityId: r.id, after: { name: r.name, kind: r.kind, rate: formatRate(r.ratePpm) }, req: ctx.req }, tx);
      return this.rateView(r);
    });
  }

  async updateRate(id: string, input: { name?: string; outputAccountId?: string; inputAccountId?: string | null }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = await this.findRate(tx, organizationId, id);
      const changed = (['name', 'outputAccountId', 'inputAccountId'] as const).filter((k) => input[k] !== undefined && input[k] !== current[k]);
      if (!changed.length) return this.rateView(current);
      if (changed.includes('name')) await this.assertRateName(tx, organizationId, input.name!, id);
      const outputAccountId = input.outputAccountId ?? current.outputAccountId;
      const inputAccountId = input.inputAccountId === undefined ? current.inputAccountId : input.inputAccountId;
      if (changed.some((k) => k !== 'name')) await this.checkAccounts(tx, organizationId, outputAccountId, inputAccountId);
      const data = Object.fromEntries(changed.map((k) => [k, input[k]]));
      const r = await tx.taxRate.update({ where: { id }, data, select: rateSelect });
      await this.audit.record(
        { action: 'org.tax_rate.update', actorId: ctx.actor.userId, organizationId, entityType: 'tax_rate', entityId: id, before: Object.fromEntries(changed.map((k) => [k, current[k]])), after: { ...data, rate: formatRate(r.ratePpm) }, req: ctx.req },
        tx,
      );
      return this.rateView(r);
    });
  }

  async archiveRate(id: string, archive: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await this.findRate(tx, organizationId, id);
      if (archive === !!r.archivedAt) throw refuse(ConflictException, archive ? 'This rate is already archived.' : 'This rate isn’t archived.', archive ? 'already_archived' : 'not_archived');
      if (archive && (await tx.taxGroupRate.count({ where: { organizationId, rateId: id, group: { archivedAt: null } } }))) {
        throw refuse(ConflictException, 'Active tax groups use this rate. Archive them first.', 'in_active_group');
      }
      const updated = await tx.taxRate.update({ where: { id }, data: { archivedAt: archive ? new Date() : null }, select: rateSelect });
      await this.audit.record({ action: archive ? 'org.tax_rate.archive' : 'org.tax_rate.restore', actorId: ctx.actor.userId, organizationId, entityType: 'tax_rate', entityId: id, after: { name: r.name, rate: formatRate(r.ratePpm) }, req: ctx.req }, tx);
      return this.rateView(updated);
    });
  }

  // ---------- groups ----------

  private async findGroup(tx: Tx | PrismaService, organizationId: string, id: string) {
    const g = await tx.taxGroup.findFirst({ where: { id, organizationId }, select: groupSelect });
    if (!g) throw new NotFoundException('Tax group not found.');
    return g;
  }

  private async assertGroupName(tx: Tx, organizationId: string, name: string, exceptId?: string) {
    if (await tx.taxGroup.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) }, select: { id: true } })) {
      throw refuse(ConflictException, 'Another tax group already has this name.', 'name_taken');
    }
  }

  /** A group's rates are fixed once created, so what an entry was taxed at never shifts underneath it. */
  async createGroup(input: { name: string; rateIds: string[] }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.assertGroupName(tx, organizationId, input.name);
      const rates = await tx.taxRate.findMany({ where: { organizationId, id: { in: input.rateIds } }, select: { id: true, archivedAt: true } });
      if (rates.length !== input.rateIds.length) throw refuse(BadRequestException, 'A rate in this group doesn’t exist.', 'rate_not_found');
      if (rates.some((r) => r.archivedAt)) throw refuse(BadRequestException, 'A rate in this group is archived.', 'rate_archived');
      const g = await tx.taxGroup.create({ data: { organizationId, name: input.name }, select: { id: true } });
      await tx.taxGroupRate.createMany({ data: input.rateIds.map((rateId, position) => ({ organizationId, groupId: g.id, rateId, position })) });
      const view = this.groupView(await this.findGroup(tx, organizationId, g.id));
      await this.audit.record({ action: 'org.tax_group.create', actorId: ctx.actor.userId, organizationId, entityType: 'tax_group', entityId: g.id, after: { name: view.name, total: view.total, rates: view.rates.map((r) => r.name) }, req: ctx.req }, tx);
      return view;
    });
  }

  async renameGroup(id: string, name: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const g = await this.findGroup(tx, organizationId, id);
      if (g.name === name) return this.groupView(g);
      await this.assertGroupName(tx, organizationId, name, id);
      await tx.taxGroup.update({ where: { id }, data: { name } });
      await this.audit.record({ action: 'org.tax_group.update', actorId: ctx.actor.userId, organizationId, entityType: 'tax_group', entityId: id, before: { name: g.name }, after: { name }, req: ctx.req }, tx);
      return this.groupView(await this.findGroup(tx, organizationId, id));
    });
  }

  async archiveGroup(id: string, archive: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const g = await this.findGroup(tx, organizationId, id);
      if (archive === !!g.archivedAt) throw refuse(ConflictException, archive ? 'This group is already archived.' : 'This group isn’t archived.', archive ? 'already_archived' : 'not_archived');
      if (!archive && g.rates.some(({ rate }) => rate.archivedAt)) throw refuse(ConflictException, 'Restore its rates first.', 'rate_archived');
      await tx.taxGroup.update({ where: { id }, data: { archivedAt: archive ? new Date() : null } });
      await this.audit.record({ action: archive ? 'org.tax_group.archive' : 'org.tax_group.restore', actorId: ctx.actor.userId, organizationId, entityType: 'tax_group', entityId: id, after: { name: g.name }, req: ctx.req }, tx);
      return this.groupView(await this.findGroup(tx, organizationId, id));
    });
  }

  // ---------- GST ----------

  /**
   * Sets GST up from the platform's slabs in one step: the input and output accounts (reusing the
   * template's 1300/2100 accounts when they're there), CGST/SGST (or UTGST) and IGST rates, and for each
   * slab an intra-state group (half CGST, half SGST/UTGST) and an inter-state group (IGST at the full rate).
   * Running it again only adds what's missing, so it also picks up slabs the Super Admin adds later.
   */
  async setupGst(slabIds: string[] | undefined, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAccounts(tx, organizationId);
      await this.lock(tx, organizationId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { country: true, region: true, locale: true, timeZone: true } });
      if (org.country !== 'IN') throw refuse(ConflictException, 'GST is for organisations in India. Set the country in Settings, or add VAT or sales tax rates yourself.', 'not_india');
      const state = findIndianState(org.region);
      const utgst = state?.utgst ?? false;
      const today = todayIn(org.timeZone);

      const all = await tx.gstSlab.findMany({ orderBy: [{ ratePpm: 'asc' }, { effectiveFrom: 'asc' }] });
      const slabs = slabIds ? all.filter((s) => slabIds.includes(s.id)) : all.filter((s) => slabInForce(GstSlabsService.view(s), today));
      if (slabIds && slabs.length !== new Set(slabIds).size) throw refuse(BadRequestException, 'A chosen GST slab doesn’t exist.', 'slab_not_found');
      if (!slabs.length) throw refuse(BadRequestException, 'Choose at least one GST slab.', 'no_slabs');

      // 1. accounts
      const lang = templateLanguage(org.locale);
      const names: Record<string, Record<string, string>> = { ...TEMPLATE_ACCOUNT_NAMES, ...UTGST_ACCOUNT_NAMES };
      const accountFor: Record<string, string> = {};
      const createdAccounts: string[] = [];
      const byCode: Record<string, string> = {};
      for (const spec of gstAccountPlan(utgst)) {
        const name = names[spec.key]?.[lang] ?? names[spec.key]!.en!;
        let a = await tx.account.findFirst({ where: { organizationId, code: spec.code }, select: { id: true, type: true, archivedAt: true, name: true } });
        a ??= await tx.account.findFirst({ where: { organizationId, type: spec.type, name: { equals: name, mode: 'insensitive' } }, select: { id: true, type: true, archivedAt: true, name: true } });
        if (a && a.type !== spec.type) {
          throw refuse(ConflictException, `Account ${spec.code} is already used for something else. Change its code, then try again.`, 'code_taken', { code: spec.code });
        }
        if (a?.archivedAt) throw refuse(ConflictException, `The account “${a.name}” is archived. Restore it, then try again.`, 'account_archived', { code: spec.code });
        if (!a) {
          a = await tx.account.create({
            data: { organizationId, code: spec.code, name, type: spec.type, subtype: spec.subtype, parentId: spec.parent ? byCode[spec.parent] : null },
            select: { id: true, type: true, archivedAt: true, name: true },
          });
          createdAccounts.push(`${spec.code} ${name}`);
        }
        byCode[spec.code] = a.id;
        if (spec.kind) accountFor[`${spec.kind}:${spec.role}`] = a.id;
      }

      // 2. rates, reused when this organisation already has the same tax at the same percentage
      const createdRates: string[] = [];
      const rateId = async (kind: 'cgst' | 'sgst' | 'utgst' | 'igst', ppm: number) => {
        const existing = await tx.taxRate.findFirst({ where: { organizationId, kind, ratePpm: ppm, archivedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (existing) return existing.id;
        let name = `${kind.toUpperCase()} ${formatRate(ppm)}`;
        if (await tx.taxRate.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) name = `${name} (GST)`;
        const r = await tx.taxRate.create({ data: { organizationId, name, kind, ratePpm: ppm, outputAccountId: accountFor[`${kind}:output`]!, inputAccountId: accountFor[`${kind}:input`]! }, select: { id: true } });
        createdRates.push(name);
        return r.id;
      };

      // 3. one intra-state and one inter-state group per slab
      const local = utgst ? 'utgst' : 'sgst';
      const createdGroups: string[] = [];
      for (const slab of slabs) {
        const retired = slab.effectiveTo && iso(slab.effectiveTo) < today;
        for (const supply of ['intra', 'inter'] as const) {
          if (await tx.taxGroup.findFirst({ where: { organizationId, gstSlabId: slab.id, supply }, select: { id: true } })) continue;
          const half = slab.ratePpm / 2;
          const rateIds = supply === 'intra' ? [await rateId('cgst', half), await rateId(local, half)] : [await rateId('igst', slab.ratePpm)];
          let name = `${supply === 'intra' ? 'GST' : 'IGST'} ${formatRate(slab.ratePpm)}${retired ? ` (to ${iso(slab.effectiveTo!)})` : ''}`;
          if (await tx.taxGroup.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) name = `${name} from ${iso(slab.effectiveFrom)}`;
          const g = await tx.taxGroup.create({ data: { organizationId, name, gstSlabId: slab.id, supply }, select: { id: true } });
          await tx.taxGroupRate.createMany({ data: rateIds.map((id, position) => ({ organizationId, groupId: g.id, rateId: id, position })) });
          createdGroups.push(name);
        }
      }

      const summary = { state: state?.name ?? null, utgst, accounts: createdAccounts, rates: createdRates, groups: createdGroups };
      await this.audit.record({ action: 'org.tax_setup.gst', actorId: ctx.actor.userId, organizationId, entityType: 'organization', entityId: organizationId, after: summary, req: ctx.req }, tx);
      return summary;
    });
    return { created: result, ...(await this.list(organizationId)) };
  }
}
