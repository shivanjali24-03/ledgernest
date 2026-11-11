import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  billNumber,
  formatQuantity,
  grnNumber,
  parseQuantity,
  poLineOpen,
  poNumber,
  todayIn,
  type PoStatus,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { BillsService } from '../bills/bills.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  goodsReceiptSchema,
  purchaseOrderDraftSchema,
} from '@ledgernest/shared';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Input = z.output<typeof purchaseOrderDraftSchema>;
type ReceiptIn = z.output<typeof goodsReceiptSchema>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const qty = (d: { toFixed(n: number): string }) =>
  formatQuantity(parseQuantity(d.toFixed(4)) ?? 0n);
/** Decimal(13,4) from a quantity in ten-thousandths */
const dec = (q: bigint) => formatQuantity(q);

const select = {
  id: true,
  number: true,
  status: true,
  orderDate: true,
  expectedDate: true,
  currency: true,
  placeOfSupply: true,
  reference: true,
  notes: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  issuedAt: true,
  createdAt: true,
  contact: { select: { id: true, name: true, email: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      id: true,
      lineNo: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPpm: true,
      amount: true,
      taxAmount: true,
      received: true,
      billed: true,
      item: { select: { id: true, name: true, unit: true } },
      account: { select: { id: true, code: true, name: true } },
      taxGroup: { select: { id: true, name: true } },
    },
  },
  receipts: {
    orderBy: { number: 'asc' as const },
    select: {
      id: true,
      number: true,
      date: true,
      reference: true,
      notes: true,
      lines: { select: { poLineId: true, quantity: true } },
    },
  },
  bills: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      fiscalYear: { select: { name: true } },
    },
  },
} as const;
type Row = Prisma.PurchaseOrderGetPayload<{ select: typeof select }>;

/**
 * Purchase orders: drafted, issued to the vendor, received against on goods receipt notes (each line up to what was
 * ordered), and billed from what came in. The bill brings the stock in, as any bill does.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bills: BillsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'purchase-orders:' + organizationId}))`;
  }

  private view(o: Row) {
    return {
      id: o.id,
      number: poNumber(o.number),
      status: o.status as PoStatus,
      orderDate: iso(o.orderDate),
      expectedDate: o.expectedDate ? iso(o.expectedDate) : null,
      currency: o.currency,
      placeOfSupply: o.placeOfSupply,
      reference: o.reference,
      notes: o.notes,
      contact: o.contact,
      subtotal: Number(o.subtotal),
      taxTotal: Number(o.taxTotal),
      total: Number(o.total),
      issuedAt: o.issuedAt,
      createdAt: o.createdAt,
      lines: o.lines.map((l) => {
        const line = {
          quantity: qty(l.quantity),
          received: qty(l.received),
          billed: qty(l.billed),
        };
        const open = poLineOpen(line);
        return {
          id: l.id,
          lineNo: l.lineNo,
          description: l.description,
          ...line,
          /** Still to come, and come but not billed */
          toReceive: formatQuantity(open.toReceive),
          toBill: formatQuantity(open.toBill),
          unitPrice: Number(l.unitPrice),
          discount: l.discountPpm / 10_000,
          amount: Number(l.amount),
          taxAmount: Number(l.taxAmount),
          item: l.item,
          account: l.account,
          taxGroup: l.taxGroup,
        };
      }),
      /** Goods receipt notes */
      receipts: o.receipts.map((r) => ({
        id: r.id,
        number: grnNumber(r.number),
        date: iso(r.date),
        reference: r.reference,
        notes: r.notes,
        lines: r.lines.map((x) => ({
          lineId: x.poLineId,
          quantity: qty(x.quantity),
        })),
      })),
      /** Bills made from it */
      bills: o.bills.map((b) => ({
        id: b.id,
        number:
          b.number && b.fiscalYear
            ? billNumber(b.fiscalYear.name, b.number)
            : null,
        status: b.status,
        total: Number(b.total),
      })),
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const o = await tx.purchaseOrder.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!o) throw new NotFoundException('Purchase order not found.');
    return o;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  async list(
    organizationId: string,
    q: {
      status?: string;
      contactId?: string;
      search?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const num = q.search
      ? /^(?:PO-)?(\d+)$/i.exec(q.search.trim())?.[1]
      : undefined;
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      ...(q.status &&
        (q.status === 'open'
          ? { status: { in: ['draft', 'issued'] } }
          : { status: q.status })),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.search && {
        OR: [
          { reference: { contains: q.search, mode: 'insensitive' } },
          { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          ...(num ? [{ number: Number(num) }] : []),
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => {
        const { lines: _l, receipts: _r, ...rest } = this.view(r);
        return rest;
      }),
    };
  }

  /** The lines checked and priced exactly as on a bill from this vendor */
  private price(organizationId: string, input: Input) {
    return this.bills.price(organizationId, {
      contactId: input.contactId,
      billDate: input.orderDate,
      dueDate: null,
      vendorReference: null,
      notes: input.notes,
      placeOfSupply: input.placeOfSupply,
      payableAccountId: null,
      rate: null,
      lines: input.lines.map((l) => ({ ...l, batchNo: null, serials: [] })),
    });
  }

  private async writeLines(
    tx: Tx,
    organizationId: string,
    purchaseOrderId: string,
    p: Awaited<ReturnType<PurchaseOrdersService['price']>>,
  ) {
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId } });
    await tx.purchaseOrderLine.createMany({
      data: p.lines.map((l, n) => ({
        organizationId,
        purchaseOrderId,
        lineNo: n + 1,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: BigInt(l.unitPrice),
        discountPpm: l.discount,
        taxGroupId: (l.group ?? l.rcmGroup)?.id ?? null,
        accountId: l.accountId,
        amount: BigInt(p.amounts.lines[n]!.net),
        taxAmount: BigInt(p.amounts.lines[n]!.tax),
      })),
    });
  }

  async create(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const p = await this.price(organizationId, input);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const last = await tx.purchaseOrder.aggregate({
        where: { organizationId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const o = await tx.purchaseOrder.create({
        data: {
          organizationId,
          number,
          contactId: p.contactId,
          orderDate: asDate(input.orderDate),
          expectedDate: input.expectedDate ? asDate(input.expectedDate) : null,
          currency: p.currency,
          placeOfSupply: p.placeOfSupply,
          reference: input.reference,
          notes: input.notes,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.writeLines(tx, organizationId, o.id, p);
      await this.audit.record(
        {
          action: 'org.purchase_order.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'purchase_order',
          entityId: o.id,
          after: { number: poNumber(number), total: p.amounts.total },
          req: ctx.req,
        },
        tx,
      );
      return o.id;
    });
    return this.get(organizationId, id);
  }

  async update(id: string, input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const p = await this.price(organizationId, input);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const o = await this.find(tx, organizationId, id);
      if (o.status !== 'draft')
        throw refuse(
          ConflictException,
          'Only a draft order can be changed.',
          'not_draft',
        );
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          contactId: p.contactId,
          orderDate: asDate(input.orderDate),
          expectedDate: input.expectedDate ? asDate(input.expectedDate) : null,
          currency: p.currency,
          placeOfSupply: p.placeOfSupply,
          reference: input.reference,
          notes: input.notes,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
        },
      });
      await this.writeLines(tx, organizationId, id, p);
      await this.audit.record(
        {
          action: 'org.purchase_order.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'purchase_order',
          entityId: id,
          after: { total: p.amounts.total },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const o = await this.find(tx, organizationId, id);
      if (o.status !== 'draft')
        throw refuse(
          ConflictException,
          'Only a draft order can be deleted. Cancel it instead.',
          'not_draft',
        );
      await tx.purchaseOrder.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.purchase_order.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'purchase_order',
          entityId: id,
          before: { number: poNumber(o.number) },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** Issued (sent to the vendor), cancelled (only before anything came), or closed short (no more to come) */
  async move(id: string, to: 'issued' | 'cancelled' | 'closed', ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const o = await this.find(tx, organizationId, id);
      const received = o.lines.some((l) => Number(l.received) > 0);
      const allowed =
        to === 'issued'
          ? o.status === 'draft'
          : to === 'cancelled'
            ? (o.status === 'draft' || o.status === 'issued') && !received
            : o.status === 'issued';
      if (!allowed)
        throw refuse(
          ConflictException,
          to === 'cancelled' && received
            ? 'Goods have been received on this order: close it instead.'
            : `A ${o.status} order can’t be ${to}.`,
          'bad_move',
          { from: o.status, to },
        );
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: to,
          ...(to === 'issued' ? { issuedAt: new Date() } : {}),
        },
      });
      await this.audit.record(
        {
          action: `org.purchase_order.${to === 'issued' ? 'issue' : to === 'cancelled' ? 'cancel' : 'close'}`,
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'purchase_order',
          entityId: id,
          after: { number: poNumber(o.number), status: to },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** A goods receipt note: what came, each line up to what's still to come on the order */
  async receive(id: string, input: ReceiptIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const o = await this.find(tx, organizationId, id);
      if (o.status !== 'issued')
        throw refuse(
          ConflictException,
          'Goods are received against an issued order.',
          'not_issued',
        );
      if (input.date < iso(o.orderDate))
        throw refuse(
          BadRequestException,
          'Goods can’t come before they’re ordered.',
          'before_order',
          { field: 'date' },
        );
      for (const r of input.lines) {
        const l = o.lines.find((x) => x.id === r.lineId);
        if (!l)
          throw refuse(
            BadRequestException,
            'A line isn’t on this order.',
            'line_not_found',
          );
        const open = poLineOpen({
          quantity: qty(l.quantity),
          received: qty(l.received),
          billed: qty(l.billed),
        });
        if (parseQuantity(r.quantity)! > open.toReceive)
          throw refuse(
            ConflictException,
            `Only ${formatQuantity(open.toReceive)} of “${l.description}” is still to come.`,
            'over_received',
            { line: l.lineNo, toReceive: formatQuantity(open.toReceive) },
          );
      }
      const last = await tx.goodsReceipt.aggregate({
        where: { organizationId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const g = await tx.goodsReceipt.create({
        data: {
          organizationId,
          number,
          purchaseOrderId: id,
          date: asDate(input.date),
          reference: input.reference,
          notes: input.notes,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await tx.goodsReceiptLine.createMany({
        data: input.lines.map((r) => ({
          organizationId,
          goodsReceiptId: g.id,
          poLineId: r.lineId,
          quantity: r.quantity,
        })),
      });
      for (const r of input.lines) {
        const l = o.lines.find((x) => x.id === r.lineId)!;
        await tx.purchaseOrderLine.update({
          where: { id: l.id },
          data: {
            received: dec(
              (parseQuantity(qty(l.received)) ?? 0n) +
                parseQuantity(r.quantity)!,
            ),
          },
        });
      }
      await this.audit.record(
        {
          action: 'org.purchase_order.receive',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'purchase_order',
          entityId: id,
          after: { receipt: grnNumber(number), lines: input.lines.length },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /**
   * A draft bill for what came and isn't billed yet, at the order's prices; the order's lines count it billed, and
   * the order closes once everything ordered is billed.
   */
  async bill(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const o = await this.find(this.prisma, organizationId, id);
    if (o.status !== 'issued')
      throw refuse(
        ConflictException,
        'Bills are made from an issued order.',
        'not_issued',
      );
    const open = o.lines
      .map((l) => ({
        l,
        toBill: poLineOpen({
          quantity: qty(l.quantity),
          received: qty(l.received),
          billed: qty(l.billed),
        }).toBill,
      }))
      .filter((x) => x.toBill > 0n);
    if (!open.length)
      throw refuse(
        ConflictException,
        'Nothing has come in that isn’t billed yet. Record a goods receipt first.',
        'nothing_to_bill',
      );
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    const bill = await this.bills.createDraft(
      {
        contactId: o.contact.id,
        billDate: todayIn(timeZone),
        dueDate: null,
        vendorReference: null,
        notes: o.notes,
        placeOfSupply: o.placeOfSupply,
        payableAccountId: null,
        rate: null,
        lines: open.map(({ l, toBill }) => ({
          itemId: l.item?.id ?? null,
          description: l.description,
          quantity: formatQuantity(toBill),
          unitPrice: Number(l.unitPrice),
          discount: l.discountPpm,
          taxGroupId: l.taxGroup?.id ?? null,
          accountId: l.account?.id ?? null,
        })),
      },
      ctx,
      async (tx, billId) => {
        await this.lock(tx, organizationId);
        await tx.bill.update({
          where: { id: billId },
          data: { purchaseOrderId: id },
        });
        for (const { l } of open)
          await tx.purchaseOrderLine.update({
            where: { id: l.id },
            data: { billed: l.received },
          });
        // Everything ordered has come and been billed: the order is done
        const left = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: id },
          select: { quantity: true, billed: true },
        });
        if (left.every((x) => Number(x.billed) >= Number(x.quantity)))
          await tx.purchaseOrder.update({
            where: { id },
            data: { status: 'closed' },
          });
      },
    );
    return {
      purchaseOrder: await this.get(organizationId, id),
      billId: bill.id,
    };
  }
}
