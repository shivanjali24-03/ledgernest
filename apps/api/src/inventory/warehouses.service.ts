import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  formatQuantity,
  parseQuantity,
  transferNumber,
  warehouseCodeFrom,
  type stockTransferSchema,
  type warehouseSchema,
  type warehouseUpdateSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from './inventory.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** A Decimal(13,4) sum as a quantity */
const qty = (d: { toFixed(n: number): string } | null) =>
  d ? (parseQuantity(d.toFixed(4)) ?? 0n) : 0n;

const select = {
  id: true,
  name: true,
  code: true,
  address: true,
  isDefault: true,
  archivedAt: true,
  createdAt: true,
} as const;

/**
 * Warehouses and the transfers between them. The first warehouse made brings a main one with it, which takes all the
 * stock there was; from then on every movement has its place, and each place its own quantities and average cost.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'warehouses:' + organizationId}))`;
  }

  /** Every warehouse with what's in it: how many items, and their value */
  async list(organizationId: string) {
    const [rows, sums] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { organizationId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select,
      }),
      this.prisma.stockMovement.groupBy({
        by: ['warehouseId', 'itemId'],
        where: { organizationId, warehouseId: { not: null } },
        _sum: { quantity: true, value: true },
      }),
    ]);
    return {
      warehouses: rows.map((w) => {
        const mine = sums.filter(
          (s) => s.warehouseId === w.id && qty(s._sum.quantity) !== 0n,
        );
        return {
          id: w.id,
          name: w.name,
          code: w.code,
          address: w.address as Record<string, string | null> | null,
          isDefault: w.isDefault,
          archived: !!w.archivedAt,
          items: mine.length,
          value: mine.reduce((t, s) => t + Number(s._sum.value ?? 0n), 0),
        };
      }),
    };
  }

  private async unique(
    tx: Tx,
    organizationId: string,
    name: string,
    code: string,
    except?: string,
  ) {
    const clash = await tx.warehouse.findFirst({
      where: {
        organizationId,
        ...(except && { id: { not: except } }),
        OR: [{ name: { equals: name, mode: 'insensitive' } }, { code }],
      },
      select: { name: true, code: true },
    });
    if (clash)
      throw refuse(
        ConflictException,
        clash.code === code
          ? `Another warehouse has the code ${code}.`
          : 'Another warehouse has this name.',
        clash.code === code ? 'code_taken' : 'name_taken',
        { field: clash.code === code ? 'code' : 'name' },
      );
  }

  async create(input: z.output<typeof warehouseSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      // The first place kept: the stock there was is in the main warehouse
      if (!(await tx.warehouse.count({ where: { organizationId } }))) {
        const main = await tx.warehouse.create({
          data: {
            organizationId,
            name: 'Main warehouse',
            code: 'MAIN',
            isDefault: true,
          },
          select: { id: true },
        });
        await tx.stockMovement.updateMany({
          where: { organizationId, warehouseId: null },
          data: { warehouseId: main.id },
        });
      }
      let code = input.code ?? warehouseCodeFrom(input.name);
      if (!input.code)
        for (
          let n = 2;
          await tx.warehouse.findFirst({
            where: { organizationId, code },
            select: { id: true },
          });
          n++
        )
          code = `${warehouseCodeFrom(input.name)}${n}`;
      await this.unique(tx, organizationId, input.name, code);
      const w = await tx.warehouse.create({
        data: {
          organizationId,
          name: input.name,
          code,
          address: (input.address ?? undefined) as
            Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'org.warehouse.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'warehouse',
          entityId: w.id,
          after: { name: input.name, code },
          req: ctx.req,
        },
        tx,
      );
      return w.id;
    });
    return (await this.list(organizationId)).warehouses.find(
      (w) => w.id === id,
    )!;
  }

  async update(
    id: string,
    input: z.output<typeof warehouseUpdateSchema>,
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const w = await tx.warehouse.findFirst({
        where: { organizationId, id },
        select,
      });
      if (!w) throw new NotFoundException('Warehouse not found.');
      if (input.name)
        await this.unique(tx, organizationId, input.name, w.code, id);
      if (input.isDefault) {
        if (w.archivedAt)
          throw refuse(
            ConflictException,
            'An archived warehouse can’t be the main one.',
            'warehouse_archived',
          );
        await tx.warehouse.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }
      await tx.warehouse.update({
        where: { id },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.address !== undefined && {
            address: (input.address ?? undefined) as
              Prisma.InputJsonValue | undefined,
          }),
          ...(input.isDefault && { isDefault: true }),
        },
      });
      await this.audit.record(
        {
          action: 'org.warehouse.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'warehouse',
          entityId: id,
          before: { name: w.name, isDefault: w.isDefault },
          after: input,
          req: ctx.req,
        },
        tx,
      );
    });
    return (await this.list(organizationId)).warehouses.find(
      (w) => w.id === id,
    )!;
  }

  /** Out of use: only once nothing is in it, and never the main one */
  async archive(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const w = await tx.warehouse.findFirst({
        where: { organizationId, id },
        select,
      });
      if (!w) throw new NotFoundException('Warehouse not found.');
      if (w.isDefault)
        throw refuse(
          ConflictException,
          'The main warehouse can’t be archived. Make another one the main one first.',
          'warehouse_default',
        );
      const left = await tx.stockMovement.groupBy({
        by: ['itemId'],
        where: { organizationId, warehouseId: id },
        _sum: { quantity: true },
      });
      if (left.some((r) => qty(r._sum.quantity) !== 0n))
        throw refuse(
          ConflictException,
          'There’s still stock in this warehouse. Move it out first.',
          'warehouse_has_stock',
        );
      await tx.warehouse.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.warehouse.archive',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'warehouse',
          entityId: id,
          before: { name: w.name },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** What's in one warehouse, item by item */
  async stock(organizationId: string, id: string) {
    const w = await this.prisma.warehouse.findFirst({
      where: { organizationId, id },
      select: { id: true },
    });
    if (!w) throw new NotFoundException('Warehouse not found.');
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['itemId'],
      where: { organizationId, warehouseId: id },
      _sum: { quantity: true, value: true },
    });
    const items = await this.prisma.item.findMany({
      where: { organizationId, id: { in: sums.map((s) => s.itemId) } },
      select: { id: true, name: true, unit: true },
    });
    return {
      items: sums
        .filter((s) => qty(s._sum.quantity) !== 0n)
        .map((s) => {
          const it = items.find((i) => i.id === s.itemId)!;
          return {
            itemId: it.id,
            name: it.name,
            unit: it.unit,
            quantity: formatQuantity(qty(s._sum.quantity)),
            value: Number(s._sum.value ?? 0n),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Goods moved from one warehouse to another at what they cost where they were; no entry */
  async transfer(input: z.output<typeof stockTransferSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const places = await tx.warehouse.findMany({
        where: {
          organizationId,
          id: { in: [input.fromWarehouseId, input.toWarehouseId] },
          archivedAt: null,
        },
        select: { id: true, name: true },
      });
      for (const [field, wid] of [
        ['fromWarehouseId', input.fromWarehouseId],
        ['toWarehouseId', input.toWarehouseId],
      ] as const)
        if (!places.some((p) => p.id === wid))
          throw refuse(
            BadRequestException,
            'Choose a warehouse in use.',
            'warehouse_invalid',
            { field },
          );
      const tracked = await tx.item.findMany({
        where: {
          organizationId,
          id: { in: input.lines.map((l) => l.itemId) },
          trackStock: true,
        },
        select: { id: true },
      });
      const notTracked = input.lines.findIndex(
        (l) => !tracked.some((t) => t.id === l.itemId),
      );
      if (notTracked >= 0)
        throw refuse(
          BadRequestException,
          `Line ${notTracked + 1} isn’t an item kept in stock.`,
          'not_tracked',
          { line: notTracked + 1 },
        );
      const last = await tx.stockTransfer.aggregate({
        where: { organizationId },
        _max: { number: true },
      });
      const t = await tx.stockTransfer.create({
        data: {
          organizationId,
          number: (last._max.number ?? 0) + 1,
          date: asDate(input.date),
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          reference: input.reference,
          notes: input.notes,
          createdById: ctx.actor.userId,
        },
        select: { id: true, number: true },
      });
      // Out at the average cost where they were (batches and serial numbers as a sale takes them), in as they left
      const out = await this.inventory.costOfSale(
        tx,
        organizationId,
        input.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          batchId: l.batchId,
          serials: l.serials,
        })),
        input.date,
        input.fromWarehouseId,
      );
      await this.inventory.save(
        tx,
        organizationId,
        {
          kind: 'transfer',
          sourceId: t.id,
          date: input.date,
          journalEntryId: null,
          actorId: ctx.actor.userId,
          reason: transferNumber(t.number),
        },
        [
          ...out.movements,
          ...out.movements.map((m) => ({
            ...m,
            quantity: -m.quantity,
            value: -m.value,
            warehouseId: input.toWarehouseId,
          })),
        ],
      );
      await this.audit.record(
        {
          action: 'org.stock.transfer',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'stock_transfer',
          entityId: t.id,
          after: {
            number: transferNumber(t.number),
            from: places.find((p) => p.id === input.fromWarehouseId)!.name,
            to: places.find((p) => p.id === input.toWarehouseId)!.name,
            lines: input.lines.length,
          },
          req: ctx.req,
        },
        tx,
      );
      return t.id;
    });
    return (await this.transfers(organizationId)).transfers.find(
      (t) => t.id === id,
    )!;
  }

  /** Recent transfers, with what moved and its value */
  async transfers(organizationId: string) {
    const rows = await this.prisma.stockTransfer.findMany({
      where: { organizationId },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 100,
      select: {
        id: true,
        number: true,
        date: true,
        reference: true,
        notes: true,
        from: { select: { id: true, name: true } },
        to: { select: { id: true, name: true } },
      },
    });
    const moved = await this.prisma.stockMovement.findMany({
      where: {
        organizationId,
        kind: 'transfer',
        sourceId: { in: rows.map((r) => r.id) },
        value: { gte: 0 },
        quantity: { gt: 0 },
      },
      select: {
        sourceId: true,
        quantity: true,
        value: true,
        item: { select: { id: true, name: true } },
      },
    });
    return {
      transfers: rows.map((r) => {
        const lines = moved.filter((m) => m.sourceId === r.id);
        return {
          id: r.id,
          number: transferNumber(r.number),
          date: iso(r.date),
          reference: r.reference,
          notes: r.notes,
          from: r.from,
          to: r.to,
          lines: lines.map((m) => ({
            item: m.item,
            quantity: formatQuantity(qty(m.quantity)),
            value: Number(m.value),
          })),
          value: lines.reduce((t, m) => t + Number(m.value), 0),
        };
      }),
    };
  }
}
