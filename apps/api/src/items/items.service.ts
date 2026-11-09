import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatRate, type ItemKind, type ItemUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Values = {
  name: string;
  kind: ItemKind;
  sku: string | null;
  description: string | null;
  unit: string | null;
  salePrice: number | null;
  purchasePrice: number | null;
  taxGroupId: string | null;
  hsnSac: string | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
};
const EDITABLE = ['name', 'kind', 'sku', 'description', 'unit', 'salePrice', 'purchasePrice', 'taxGroupId', 'hsnSac', 'incomeAccountId', 'expenseAccountId'] as const;

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const select = {
  id: true,
  name: true,
  kind: true,
  sku: true,
  description: true,
  unit: true,
  salePrice: true,
  purchasePrice: true,
  taxGroupId: true,
  hsnSac: true,
  incomeAccountId: true,
  expenseAccountId: true,
  archivedAt: true,
  taxGroup: { select: { id: true, name: true, rates: { select: { rate: { select: { ratePpm: true } } } } } },
  incomeAccount: { select: { id: true, code: true, name: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
} as const;
type Row = Prisma.ItemGetPayload<{ select: typeof select }>;

/** Products and services. Names and SKUs are unique per organisation; an item in use is archived, not deleted. */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'items:' + organizationId}))`;
  }

  private view(i: Row) {
    const { taxGroup, archivedAt, ...rest } = i;
    return {
      ...rest,
      kind: i.kind as ItemKind,
      salePrice: i.salePrice === null ? null : Number(i.salePrice),
      purchasePrice: i.purchasePrice === null ? null : Number(i.purchasePrice),
      taxGroup: taxGroup && { id: taxGroup.id, name: taxGroup.name, total: formatRate(taxGroup.rates.reduce((s, r) => s + r.rate.ratePpm, 0)) },
      archived: !!archivedAt,
    };
  }

  private async find(tx: Tx | PrismaService, organizationId: string, id: string) {
    const i = await tx.item.findFirst({ where: { id, organizationId }, select });
    if (!i) throw new NotFoundException('Item not found.');
    return i;
  }

  async list(organizationId: string, q: { search?: string; kind?: ItemKind; archived: boolean }) {
    const rows = await this.prisma.item.findMany({
      where: {
        organizationId,
        archivedAt: q.archived ? { not: null } : null,
        ...(q.kind && { kind: q.kind }),
        ...(q.search && { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search.toUpperCase() } }, { hsnSac: { startsWith: q.search } }] }),
      },
      orderBy: { name: 'asc' },
      take: 500,
      select,
    });
    return rows.map((r) => this.view(r));
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  /** Unique name and SKU; the tax group and accounts must be usable and of the right kind. */
  private async check(tx: Tx, organizationId: string, v: Values, exceptId?: string) {
    const not = exceptId ? { NOT: { id: exceptId } } : {};
    if (await tx.item.findFirst({ where: { organizationId, name: { equals: v.name, mode: 'insensitive' }, ...not }, select: { id: true } })) throw refuse(ConflictException, 'Another item already has this name.', 'name_taken', { field: 'name' });
    if (v.sku && (await tx.item.findFirst({ where: { organizationId, sku: v.sku, ...not }, select: { id: true } }))) throw refuse(ConflictException, 'Another item already has this SKU.', 'sku_taken', { field: 'sku' });
    if (v.taxGroupId) {
      const g = await tx.taxGroup.findFirst({ where: { organizationId, id: v.taxGroupId }, select: { archivedAt: true } });
      if (!g) throw refuse(BadRequestException, 'That tax group doesn’t exist.', 'tax_group_not_found', { field: 'taxGroupId' });
      if (g.archivedAt) throw refuse(BadRequestException, 'That tax group is archived.', 'tax_group_archived', { field: 'taxGroupId' });
    }
    const account = async (id: string | null, field: string, types: string[], reason: string, message: string) => {
      if (!id) return;
      const a = await tx.account.findFirst({ where: { organizationId, id }, select: { type: true, archivedAt: true } });
      if (!a) throw refuse(BadRequestException, 'That account doesn’t exist.', 'account_not_found', { field });
      if (!types.includes(a.type)) throw refuse(BadRequestException, message, reason, { field });
      if (a.archivedAt) throw refuse(BadRequestException, 'That account is archived.', 'account_archived', { field });
    };
    await account(v.incomeAccountId, 'incomeAccountId', ['income'], 'income_account_type', 'Sales of an item go to an income account.');
    await account(v.expenseAccountId, 'expenseAccountId', ['expense', 'asset'], 'expense_account_type', 'Purchases of an item go to an expense or asset account.');
  }

  private data(v: Partial<Values>) {
    return { ...v, ...('salePrice' in v && { salePrice: v.salePrice === null ? null : BigInt(v.salePrice!) }), ...('purchasePrice' in v && { purchasePrice: v.purchasePrice === null ? null : BigInt(v.purchasePrice!) }) };
  }

  async create(input: Values, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.check(tx, organizationId, input);
      const i = await tx.item.create({ data: { organizationId, ...this.data(input) } as Prisma.ItemUncheckedCreateInput, select });
      await this.audit.record({ action: 'org.item.create', actorId: ctx.actor.userId, organizationId, entityType: 'item', entityId: i.id, after: { name: i.name, kind: i.kind, sku: i.sku, salePrice: input.salePrice }, req: ctx.req }, tx);
      return this.view(i);
    });
  }

  async update(id: string, input: ItemUpdateInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = this.view(await this.find(tx, organizationId, id));
      const merged = { ...Object.fromEntries(EDITABLE.map((k) => [k, current[k]])), ...input } as Values;
      const changed = EDITABLE.filter((k) => k in input && merged[k] !== current[k]);
      if (!changed.length) return current;
      await this.check(tx, organizationId, merged, id);
      const patch = Object.fromEntries(changed.map((k) => [k, merged[k]])) as Partial<Values>;
      const i = await tx.item.update({ where: { id }, data: this.data(patch) as Prisma.ItemUncheckedUpdateInput, select });
      await this.audit.record({ action: 'org.item.update', actorId: ctx.actor.userId, organizationId, entityType: 'item', entityId: id, before: Object.fromEntries(changed.map((k) => [k, current[k]])), after: patch, req: ctx.req }, tx);
      return this.view(i);
    });
  }

  async archive(id: string, archive: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (archive === !!i.archivedAt) throw refuse(ConflictException, archive ? 'This item is already archived.' : 'This item isn’t archived.', archive ? 'already_archived' : 'not_archived');
      const updated = await tx.item.update({ where: { id }, data: { archivedAt: archive ? new Date() : null }, select });
      await this.audit.record({ action: archive ? 'org.item.archive' : 'org.item.restore', actorId: ctx.actor.userId, organizationId, entityType: 'item', entityId: id, after: { name: i.name }, req: ctx.req }, tx);
      return this.view(updated);
    });
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      await tx.item.delete({ where: { id } });
      await this.audit.record({ action: 'org.item.delete', actorId: ctx.actor.userId, organizationId, entityType: 'item', entityId: id, before: { name: i.name }, req: ctx.req }, tx);
    });
  }
}
