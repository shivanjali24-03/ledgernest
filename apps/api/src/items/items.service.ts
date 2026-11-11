import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  averageUnitCost,
  formatQuantity,
  formatRate,
  parseQuantity,
  type ItemKind,
  type ItemUpdateInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { major, toCsv } from '../common/list-export.js';
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
  trackStock: boolean;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
  reorderLevel: string | null;
  mrp?: number | null;
  barcode?: string | null;
  brand?: string | null;
  category?: string | null;
};
const EDITABLE = [
  'name',
  'kind',
  'sku',
  'description',
  'unit',
  'salePrice',
  'purchasePrice',
  'taxGroupId',
  'hsnSac',
  'incomeAccountId',
  'expenseAccountId',
  'trackStock',
  'inventoryAccountId',
  'cogsAccountId',
  'reorderLevel',
  'mrp',
  'barcode',
  'brand',
  'category',
] as const;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });

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
  trackStock: true,
  inventoryAccountId: true,
  cogsAccountId: true,
  reorderLevel: true,
  mrp: true,
  barcode: true,
  brand: true,
  category: true,
  archivedAt: true,
  taxGroup: {
    select: {
      id: true,
      name: true,
      rates: { select: { rate: { select: { ratePpm: true } } } },
    },
  },
  incomeAccount: { select: { id: true, code: true, name: true } },
  expenseAccount: { select: { id: true, code: true, name: true } },
  inventoryAccount: { select: { id: true, code: true, name: true } },
  cogsAccount: { select: { id: true, code: true, name: true } },
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

  private view(i: Row, stock?: { quantity: bigint; value: bigint }) {
    const { taxGroup, archivedAt, reorderLevel, ...rest } = i;
    const level =
      reorderLevel === null ? null : parseQuantity(reorderLevel.toFixed(4));
    return {
      ...rest,
      reorderLevel: level === null ? null : formatQuantity(level),
      /** For tracked goods: what's on hand and what it cost */
      stock: i.trackStock
        ? {
            onHand: formatQuantity(
              (stock?.quantity ?? 0n) > 0n ? stock!.quantity : 0n,
            ),
            value: Number(stock?.value ?? 0n),
            averageCost: averageUnitCost(
              stock?.quantity ?? 0n,
              stock?.value ?? 0n,
            ),
            /** At or below its reorder level */
            low: level !== null && (stock?.quantity ?? 0n) <= level,
          }
        : null,
      kind: i.kind as ItemKind,
      salePrice: i.salePrice === null ? null : Number(i.salePrice),
      purchasePrice: i.purchasePrice === null ? null : Number(i.purchasePrice),
      mrp: i.mrp === null ? null : Number(i.mrp),
      taxGroup: taxGroup && {
        id: taxGroup.id,
        name: taxGroup.name,
        total: formatRate(
          taxGroup.rates.reduce((s, r) => s + r.rate.ratePpm, 0),
        ),
      },
      archived: !!archivedAt,
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const i = await tx.item.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!i) throw new NotFoundException('Item not found.');
    return i;
  }

  async list(
    organizationId: string,
    q: {
      search?: string;
      kind?: ItemKind;
      category?: string;
      archived: boolean;
    },
  ) {
    const rows = await this.prisma.item.findMany({
      where: {
        organizationId,
        archivedAt: q.archived ? { not: null } : null,
        ...(q.kind && { kind: q.kind }),
        ...(q.category && {
          category: { equals: q.category, mode: 'insensitive' },
        }),
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { sku: { contains: q.search.toUpperCase() } },
            { hsnSac: { startsWith: q.search } },
            // A scanned barcode finds its item exactly
            { barcode: q.search },
            { brand: { contains: q.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      take: 500,
      select,
    });
    const stock = await this.stockOf(
      organizationId,
      rows.filter((r) => r.trackStock).map((r) => r.id),
    );
    return rows.map((r) => this.view(r, stock.get(r.id)));
  }

  private async stockOf(organizationId: string, itemIds: string[]) {
    if (!itemIds.length)
      return new Map<string, { quantity: bigint; value: bigint }>();
    const rows = await this.prisma.stockMovement.groupBy({
      by: ['itemId'],
      where: { organizationId, itemId: { in: itemIds } },
      _sum: { quantity: true, value: true },
    });
    return new Map(
      rows.map((r) => [
        r.itemId,
        {
          quantity: r._sum.quantity
            ? String(r._sum.quantity).startsWith('-')
              ? -(parseQuantity(String(r._sum.quantity).slice(1)) ?? 0n)
              : (parseQuantity(String(r._sum.quantity)) ?? 0n)
            : 0n,
          value: r._sum.value ?? 0n,
        },
      ]),
    );
  }

  /** The categories and brands in use, for the item form's suggestions */
  async facets(organizationId: string) {
    const [categories, brands] = await Promise.all([
      this.prisma.item.findMany({
        where: { organizationId, category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
        take: 500,
      }),
      this.prisma.item.findMany({
        where: { organizationId, brand: { not: null } },
        distinct: ['brand'],
        select: { brand: true },
        orderBy: { brand: 'asc' },
        take: 500,
      }),
    ]);
    return {
      categories: categories.map((c) => c.category!),
      brands: brands.map((b) => b.brand!),
    };
  }

  /** Items as CSV, in the columns the items import reads (prices in the base currency); recorded as an export */
  async exportCsv(
    organizationId: string,
    q: {
      search?: string;
      kind?: ItemKind;
      category?: string;
      archived: boolean;
    },
    ctx: Ctx,
  ) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const rows = await this.list(organizationId, q);
    await this.audit.record({
      action: 'org.report.export',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'report',
      entityId: 'items',
      after: { report: 'items', ...q, rows: rows.length },
      req: ctx.req,
    });
    return toCsv([
      [
        'name',
        'kind',
        'sku',
        'unit',
        'sale price',
        'purchase price',
        'hsn/sac',
        'income account',
        'expense account',
        'description',
        'mrp',
        'barcode',
        'brand',
        'category',
      ],
      ...rows.map((i) => [
        i.name,
        i.kind,
        i.sku ?? '',
        i.unit ?? '',
        i.salePrice === null ? '' : major(i.salePrice, baseCurrency),
        i.purchasePrice === null ? '' : major(i.purchasePrice, baseCurrency),
        i.hsnSac ?? '',
        i.incomeAccount?.code ?? '',
        i.expenseAccount?.code ?? '',
        i.description ?? '',
        i.mrp === null ? '' : major(i.mrp, baseCurrency),
        i.barcode ?? '',
        i.brand ?? '',
        i.category ?? '',
      ]),
    ]);
  }

  async get(organizationId: string, id: string) {
    const i = await this.find(this.prisma, organizationId, id);
    return this.view(
      i,
      (await this.stockOf(organizationId, i.trackStock ? [id] : [])).get(id),
    );
  }

  /** Unique name and SKU; the tax group and accounts must be usable and of the right kind. */
  private async check(
    tx: Tx,
    organizationId: string,
    v: Values,
    exceptId?: string,
  ) {
    const not = exceptId ? { NOT: { id: exceptId } } : {};
    if (
      await tx.item.findFirst({
        where: {
          organizationId,
          name: { equals: v.name, mode: 'insensitive' },
          ...not,
        },
        select: { id: true },
      })
    )
      throw refuse(
        ConflictException,
        'Another item already has this name.',
        'name_taken',
        { field: 'name' },
      );
    if (
      v.sku &&
      (await tx.item.findFirst({
        where: { organizationId, sku: v.sku, ...not },
        select: { id: true },
      }))
    )
      throw refuse(
        ConflictException,
        'Another item already has this SKU.',
        'sku_taken',
        { field: 'sku' },
      );
    if (
      v.barcode &&
      (await tx.item.findFirst({
        where: { organizationId, barcode: v.barcode, ...not },
        select: { id: true },
      }))
    )
      throw refuse(
        ConflictException,
        'Another item already has this barcode.',
        'barcode_taken',
        { field: 'barcode' },
      );
    // The MRP includes tax, so a price before tax above it can only be a mistake
    if (v.mrp != null && v.salePrice != null && v.salePrice > v.mrp)
      throw refuse(
        BadRequestException,
        'The sale price is more than the MRP printed on the pack.',
        'above_mrp',
        { field: 'salePrice' },
      );
    if (v.taxGroupId) {
      const g = await tx.taxGroup.findFirst({
        where: { organizationId, id: v.taxGroupId },
        select: { archivedAt: true },
      });
      if (!g)
        throw refuse(
          BadRequestException,
          'That tax group doesn’t exist.',
          'tax_group_not_found',
          { field: 'taxGroupId' },
        );
      if (g.archivedAt)
        throw refuse(
          BadRequestException,
          'That tax group is archived.',
          'tax_group_archived',
          { field: 'taxGroupId' },
        );
    }
    const account = async (
      id: string | null,
      field: string,
      types: string[],
      reason: string,
      message: string,
    ) => {
      if (!id) return;
      const a = await tx.account.findFirst({
        where: { organizationId, id },
        select: { type: true, archivedAt: true },
      });
      if (!a)
        throw refuse(
          BadRequestException,
          'That account doesn’t exist.',
          'account_not_found',
          { field },
        );
      if (!types.includes(a.type))
        throw refuse(BadRequestException, message, reason, { field });
      if (a.archivedAt)
        throw refuse(
          BadRequestException,
          'That account is archived.',
          'account_archived',
          { field },
        );
    };
    await account(
      v.incomeAccountId,
      'incomeAccountId',
      ['income'],
      'income_account_type',
      'Sales of an item go to an income account.',
    );
    await account(
      v.expenseAccountId,
      'expenseAccountId',
      ['expense', 'asset'],
      'expense_account_type',
      'Purchases of an item go to an expense or asset account.',
    );
    if (v.trackStock) {
      if (v.kind !== 'goods')
        throw refuse(
          BadRequestException,
          'Only goods have stock to track.',
          'not_goods',
          { field: 'trackStock' },
        );
      if (!v.inventoryAccountId)
        throw refuse(
          BadRequestException,
          'Choose the inventory account the stock sits in.',
          'inventory_account_required',
          { field: 'inventoryAccountId' },
        );
      if (!v.cogsAccountId)
        throw refuse(
          BadRequestException,
          'Choose the cost of sales account stock goes to as it sells.',
          'cogs_account_required',
          { field: 'cogsAccountId' },
        );
    }
    await account(
      v.inventoryAccountId,
      'inventoryAccountId',
      ['asset'],
      'inventory_account_type',
      'Stock sits in an asset account.',
    );
    await account(
      v.cogsAccountId,
      'cogsAccountId',
      ['expense'],
      'cogs_account_type',
      'The cost of stock sold goes to an expense account.',
    );
  }

  private data(v: Partial<Values>) {
    return {
      ...v,
      ...('salePrice' in v && {
        salePrice: v.salePrice === null ? null : BigInt(v.salePrice!),
      }),
      ...('purchasePrice' in v && {
        purchasePrice:
          v.purchasePrice === null ? null : BigInt(v.purchasePrice!),
      }),
      ...('mrp' in v && {
        mrp: v.mrp === null || v.mrp === undefined ? null : BigInt(v.mrp),
      }),
    };
  }

  async create(input: Values, ctx: Ctx) {
    return this.prisma.$transaction((tx) => this.createInTx(tx, input, ctx));
  }

  /** The same, inside the caller's transaction (imports create many in one) */
  async createInTx(tx: Tx, input: Values, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.lock(tx, organizationId);
    await this.check(tx, organizationId, input);
    const i = await tx.item.create({
      data: {
        organizationId,
        ...this.data(input),
      } as Prisma.ItemUncheckedCreateInput,
      select,
    });
    await this.audit.record(
      {
        action: 'org.item.create',
        actorId: ctx.actor.userId,
        organizationId,
        entityType: 'item',
        entityId: i.id,
        after: {
          name: i.name,
          kind: i.kind,
          sku: i.sku,
          salePrice: input.salePrice,
        },
        req: ctx.req,
      },
      tx,
    );
    return this.view(i);
  }

  async update(id: string, input: ItemUpdateInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = this.view(await this.find(tx, organizationId, id));
      const merged = {
        ...Object.fromEntries(EDITABLE.map((k) => [k, current[k]])),
        ...input,
      } as Values;
      const changed = EDITABLE.filter(
        (k) => k in input && merged[k] !== current[k],
      );
      if (!changed.length) return current;
      await this.check(tx, organizationId, merged, id);
      if (
        current.trackStock &&
        (changed.includes('trackStock') ||
          changed.includes('inventoryAccountId') ||
          changed.includes('kind'))
      ) {
        const moved = await tx.stockMovement.count({
          where: { organizationId, itemId: id },
        });
        if (moved)
          throw refuse(
            ConflictException,
            'This item has stock movements. Its stock tracking and inventory account can’t change now.',
            'stock_moved',
            { field: 'trackStock' },
          );
      }
      const patch = Object.fromEntries(
        changed.map((k) => [k, merged[k]]),
      ) as Partial<Values>;
      const i = await tx.item.update({
        where: { id },
        data: this.data(patch) as Prisma.ItemUncheckedUpdateInput,
        select,
      });
      await this.audit.record(
        {
          action: 'org.item.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'item',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, current[k]])),
          after: patch,
          req: ctx.req,
        },
        tx,
      );
      return this.view(i);
    });
  }

  async archive(id: string, archive: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (archive === !!i.archivedAt)
        throw refuse(
          ConflictException,
          archive
            ? 'This item is already archived.'
            : 'This item isn’t archived.',
          archive ? 'already_archived' : 'not_archived',
        );
      const updated = await tx.item.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
        select,
      });
      await this.audit.record(
        {
          action: archive ? 'org.item.archive' : 'org.item.restore',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'item',
          entityId: id,
          after: { name: i.name },
          req: ctx.req,
        },
        tx,
      );
      return this.view(updated);
    });
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (
        (await tx.invoiceLine.count({
          where: { organizationId, itemId: id },
        })) ||
        (await tx.billLine.count({ where: { organizationId, itemId: id } })) ||
        (await tx.stockMovement.count({
          where: { organizationId, itemId: id },
        }))
      )
        throw refuse(
          ConflictException,
          'Invoices or bills use this item. Archive it instead.',
          'in_use',
        );
      await tx.item.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.item.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'item',
          entityId: id,
          before: { name: i.name },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
