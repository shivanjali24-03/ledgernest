import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  averageUnitCost,
  billNumber,
  costOfQuantity,
  formatQuantity,
  invoiceNumber,
  parseQuantity,
  todayIn,
  type EnteredLine,
  type StockMovementKind,
  type stockAdjustmentSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Movement = { itemId: string; quantity: bigint; value: bigint };
const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** Decimal(13,4) as ten-thousandths */
const tenThousandths = (d: Prisma.Decimal | string) =>
  parseQuantity(String(d).replace(/^-/, '')) ?? 0n;
const signed = (d: Prisma.Decimal) =>
  String(d).startsWith('-') ? -tenThousandths(d) : tenThousandths(d);
/** A signed quantity in ten-thousandths as text, e.g. "-2.5" */
const qtyText = (q: bigint) =>
  `${q < 0n ? '-' : ''}${formatQuantity(q < 0n ? -q : q)}`;
const onHandText = (q: bigint) => formatQuantity(q > 0n ? q : 0n);

/**
 * Stock at weighted average cost. Bills bring tracked goods into their inventory account at what they cost;
 * invoices take them out at the average cost of what's on hand, posting it to cost of sales; adjustments
 * count stock up or down against another account. Voiding a document puts its stock movement back.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'inventory:' + organizationId}))`;
  }

  /** Quantity (ten-thousandths) and value on hand for some items, optionally as of a day */
  async onHand(
    tx: Tx | PrismaService,
    organizationId: string,
    itemIds?: string[],
    asOf?: string,
  ) {
    const rows = await tx.stockMovement.groupBy({
      by: ['itemId'],
      where: {
        organizationId,
        ...(itemIds && { itemId: { in: itemIds } }),
        ...(asOf && { date: { lte: asDate(asOf) } }),
      },
      _sum: { quantity: true, value: true },
    });
    return new Map(
      rows.map((r) => [
        r.itemId,
        {
          quantity: r._sum.quantity ? signed(r._sum.quantity) : 0n,
          value: r._sum.value ?? 0n,
        },
      ]),
    );
  }

  private async tracked(
    tx: Tx,
    organizationId: string,
    itemIds: (string | null)[],
  ) {
    const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
    if (!ids.length)
      return new Map<
        string,
        {
          id: string;
          name: string;
          inventoryAccountId: string;
          cogsAccountId: string;
        }
      >();
    const items = await tx.item.findMany({
      where: { organizationId, id: { in: ids }, trackStock: true },
      select: {
        id: true,
        name: true,
        inventoryAccountId: true,
        cogsAccountId: true,
      },
    });
    return new Map(
      items.map((i) => [
        i.id,
        {
          id: i.id,
          name: i.name,
          inventoryAccountId: i.inventoryAccountId!,
          cogsAccountId: i.cogsAccountId!,
        },
      ]),
    );
  }

  /** The inventory account each tracked item on some lines is bought into */
  async inventoryAccounts(
    tx: Tx,
    organizationId: string,
    itemIds: (string | null)[],
  ) {
    const t = await this.tracked(tx, organizationId, itemIds);
    return new Map([...t].map(([id, i]) => [id, i.inventoryAccountId]));
  }

  /**
   * For an invoice being issued: what its tracked goods cost at today's average, and the journal lines moving
   * that from stock to cost of sales. Refuses if there isn't enough on hand.
   */
  async costOfSale(
    tx: Tx,
    organizationId: string,
    lines: {
      itemId: string | null;
      quantity: string;
      costCentreId?: string | null;
    }[],
  ) {
    const items = await this.tracked(
      tx,
      organizationId,
      lines.map((l) => l.itemId),
    );
    if (!items.size)
      return { movements: [] as Movement[], journal: [] as EnteredLine[] };
    await this.lock(tx, organizationId);
    const stock = await this.onHand(tx, organizationId, [...items.keys()]);
    const movements: Movement[] = [];
    const journal: EnteredLine[] = [];
    for (const l of lines) {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      if (!item) continue;
      const q = parseQuantity(l.quantity)!;
      const s = stock.get(item.id) ?? { quantity: 0n, value: 0n };
      if (q > s.quantity)
        throw refuse(
          ConflictException,
          `Only ${onHandText(s.quantity)} of ${item.name} in stock.`,
          'insufficient_stock',
          { itemId: item.id, onHand: onHandText(s.quantity) },
        );
      const value = costOfQuantity(s.quantity, s.value, q);
      stock.set(item.id, { quantity: s.quantity - q, value: s.value - value });
      movements.push({ itemId: item.id, quantity: -q, value: -value });
      if (value > 0n) {
        const description = `Cost of ${item.name}`;
        journal.push(
          {
            accountId: item.cogsAccountId,
            description,
            debit: Number(value),
            credit: 0,
            costCentreId: l.costCentreId ?? null,
          },
          {
            accountId: item.inventoryAccountId,
            description,
            debit: 0,
            credit: Number(value),
          },
        );
      }
    }
    return { movements, journal };
  }

  /** For a bill being recorded: its tracked lines come into stock at their cost (net of tax, in the base currency) */
  async receipts(
    tx: Tx,
    organizationId: string,
    lines: { itemId: string | null; quantity: string; value: number }[],
  ) {
    const items = await this.tracked(
      tx,
      organizationId,
      lines.map((l) => l.itemId),
    );
    return lines
      .filter((l) => l.itemId && items.has(l.itemId))
      .map((l): Movement => ({
        itemId: l.itemId!,
        quantity: parseQuantity(l.quantity)!,
        value: BigInt(l.value),
      }));
  }

  async save(
    tx: Tx,
    organizationId: string,
    m: {
      kind: StockMovementKind;
      sourceId: string | null;
      date: string;
      journalEntryId: string | null;
      actorId: string;
      reason?: string | null;
    },
    movements: Movement[],
  ) {
    if (!movements.length) return;
    await this.lock(tx, organizationId);
    await tx.stockMovement.createMany({
      data: movements.map((x) => ({
        organizationId,
        itemId: x.itemId,
        date: asDate(m.date),
        kind: m.kind,
        sourceId: m.sourceId,
        quantity: qtyText(x.quantity),
        value: x.value,
        reason: m.reason ?? null,
        journalEntryId: m.journalEntryId,
        createdById: m.actorId,
      })),
    });
  }

  /**
   * Voiding a bill or invoice: its stock movements are put back. Stock from a bill can only go back while it's
   * still on hand.
   */
  async undoDocument(
    tx: Tx,
    organizationId: string,
    kind: 'bill' | 'invoice',
    sourceId: string,
    date: string,
    journalEntryId: string | null,
    actorId: string,
  ) {
    const done = await tx.stockMovement.findMany({
      where: { organizationId, kind, sourceId },
      select: {
        itemId: true,
        quantity: true,
        value: true,
        item: { select: { name: true } },
      },
    });
    if (!done.length) return;
    await this.lock(tx, organizationId);
    if (kind === 'bill') {
      const stock = await this.onHand(tx, organizationId, [
        ...new Set(done.map((d) => d.itemId)),
      ]);
      for (const d of done) {
        const s = stock.get(d.itemId)!;
        const q = signed(d.quantity);
        if (q > s.quantity)
          throw refuse(
            ConflictException,
            `Some of the ${d.item.name} on this bill has been sold or written off.`,
            'stock_used',
            { itemId: d.itemId },
          );
        stock.set(d.itemId, {
          quantity: s.quantity - q,
          value: s.value - d.value,
        });
      }
    }
    await this.save(
      tx,
      organizationId,
      {
        kind: kind === 'bill' ? 'bill_void' : 'invoice_void',
        sourceId,
        date,
        journalEntryId,
        actorId,
      },
      done.map((d) => ({
        itemId: d.itemId,
        quantity: -signed(d.quantity),
        value: -d.value,
      })),
    );
  }

  // ---------- adjustments ----------

  async adjust(input: z.output<typeof stockAdjustmentSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const item = await tx.item.findFirst({
        where: { organizationId, id: input.itemId },
        select: {
          id: true,
          name: true,
          trackStock: true,
          inventoryAccountId: true,
          archivedAt: true,
        },
      });
      if (!item) throw new NotFoundException('Item not found.');
      if (!item.trackStock)
        throw refuse(
          BadRequestException,
          'This item’s stock isn’t tracked.',
          'not_tracked',
          { field: 'itemId' },
        );
      const other = await tx.account.findFirst({
        where: { organizationId, id: input.accountId },
        select: { id: true, archivedAt: true },
      });
      if (!other || other.archivedAt || other.id === item.inventoryAccountId)
        throw refuse(
          BadRequestException,
          'Choose another account for the other side.',
          'account_invalid',
          { field: 'accountId' },
        );
      const q = parseQuantity(input.quantity)!;
      const s = (await this.onHand(tx, organizationId, [item.id])).get(
        item.id,
      ) ?? { quantity: 0n, value: 0n };
      let value: bigint;
      if (input.direction === 'out') {
        if (q > s.quantity)
          throw refuse(
            ConflictException,
            `Only ${onHandText(s.quantity)} of ${item.name} in stock.`,
            'insufficient_stock',
            { itemId: item.id },
          );
        value = costOfQuantity(s.quantity, s.value, q);
      } else {
        const unit = input.unitCost ?? averageUnitCost(s.quantity, s.value);
        if (unit === null)
          throw refuse(
            BadRequestException,
            'There’s none in stock to take the cost from. Enter what one cost.',
            'unit_cost_required',
            { field: 'unitCost' },
          );
        value = (BigInt(unit) * q * 2n + 10_000n) / 20_000n;
      }
      let entry: { id: string } | null = null;
      if (value > 0n) {
        const memo = `Stock ${input.direction === 'in' ? 'added' : 'written off'}: ${item.name} · ${input.reason}`;
        const v = Number(value);
        entry = await this.journals.postEntryInTx(
          tx,
          organizationId,
          {
            date: input.date,
            memo,
            reference: null,
            lines:
              input.direction === 'in'
                ? [
                    {
                      accountId: item.inventoryAccountId!,
                      description: memo,
                      debit: v,
                      credit: 0,
                    },
                    {
                      accountId: other.id,
                      description: memo,
                      debit: 0,
                      credit: v,
                    },
                  ]
                : [
                    {
                      accountId: other.id,
                      description: memo,
                      debit: v,
                      credit: 0,
                    },
                    {
                      accountId: item.inventoryAccountId!,
                      description: memo,
                      debit: 0,
                      credit: v,
                    },
                  ],
          },
          ctx.actor.userId,
        );
      }
      const m = await tx.stockMovement.create({
        data: {
          organizationId,
          itemId: item.id,
          date: asDate(input.date),
          kind: 'adjustment',
          quantity: qtyText(input.direction === 'out' ? -q : q),
          value: input.direction === 'out' ? -value : value,
          reason: input.reason,
          journalEntryId: entry?.id ?? null,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'org.stock.adjust',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'item',
          entityId: item.id,
          after: {
            name: item.name,
            direction: input.direction,
            quantity: formatQuantity(q),
            value: Number(value),
            reason: input.reason,
          },
          req: ctx.req,
        },
        tx,
      );
      return m.id;
    });
    return this.movement(organizationId, id);
  }

  /** Undoing an adjustment: its entry is reversed and its quantity put back (stock added must still be on hand) */
  async undoAdjustment(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const m = await tx.stockMovement.findFirst({
        where: { organizationId, id, kind: 'adjustment' },
        select: {
          id: true,
          itemId: true,
          quantity: true,
          value: true,
          journalEntryId: true,
          reason: true,
          item: { select: { name: true } },
        },
      });
      if (!m) throw new NotFoundException('Adjustment not found.');
      if (
        await tx.stockMovement.findFirst({
          where: { organizationId, kind: 'adjustment_undo', sourceId: id },
          select: { id: true },
        })
      )
        throw refuse(
          ConflictException,
          'This adjustment has already been undone.',
          'already_undone',
        );
      const q = signed(m.quantity);
      if (q > 0n) {
        const s = (await this.onHand(tx, organizationId, [m.itemId])).get(
          m.itemId,
        )!;
        if (q > s.quantity)
          throw refuse(
            ConflictException,
            `Some of the ${m.item.name} added has been sold or written off since.`,
            'stock_used',
          );
      }
      const { timeZone } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { timeZone: true },
      });
      const today = todayIn(timeZone);
      const reversal = m.journalEntryId
        ? await this.journals.reverseInTx(
            tx,
            organizationId,
            m.journalEntryId,
            ctx.actor.userId,
            { date: today, memo: `Stock adjustment undone: ${m.item.name}` },
            { system: true },
          )
        : null;
      await tx.stockMovement.create({
        data: {
          organizationId,
          itemId: m.itemId,
          date: asDate(today),
          kind: 'adjustment_undo',
          sourceId: id,
          quantity: qtyText(-q),
          value: -m.value,
          reason: m.reason,
          journalEntryId: reversal?.id ?? null,
          createdById: ctx.actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'org.stock.adjust_undo',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'item',
          entityId: m.itemId,
          before: {
            name: m.item.name,
            quantity: String(m.quantity),
            reason: m.reason,
          },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  // ---------- reading ----------

  /** One movement, with what was on hand after it */
  private async movement(organizationId: string, id: string) {
    const { itemId } = await this.prisma.stockMovement.findFirstOrThrow({
      where: { organizationId, id },
      select: { itemId: true },
    });
    return (await this.movements(organizationId, itemId)).movements.find(
      (m) => m.id === id,
    )!;
  }

  /** An item's movements, oldest first, with the quantity and value on hand after each */
  async movements(organizationId: string, itemId: string) {
    const rows = await this.prisma.stockMovement.findMany({
      where: { organizationId, itemId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        itemId: true,
        date: true,
        kind: true,
        sourceId: true,
        quantity: true,
        value: true,
        reason: true,
        createdAt: true,
        journalEntry: {
          select: {
            id: true,
            number: true,
            fiscalYear: { select: { name: true } },
          },
        },
        item: { select: { name: true } },
      },
    });
    const undone = new Set(
      (
        await this.prisma.stockMovement.findMany({
          where: { organizationId, kind: 'adjustment_undo', itemId },
          select: { sourceId: true },
        })
      ).map((u) => u.sourceId),
    );
    const docs = new Map<string, string | null>();
    for (const r of rows.filter(
      (x) =>
        x.sourceId &&
        ['bill', 'bill_void', 'invoice', 'invoice_void'].includes(x.kind),
    ))
      docs.set(r.sourceId!, null);
    if (docs.size) {
      const ids = [...docs.keys()];
      const [bills, invoices] = await Promise.all([
        this.prisma.bill.findMany({
          where: { organizationId, id: { in: ids } },
          select: {
            id: true,
            number: true,
            fiscalYear: { select: { name: true } },
          },
        }),
        this.prisma.invoice.findMany({
          where: { organizationId, id: { in: ids } },
          select: {
            id: true,
            number: true,
            fiscalYear: { select: { name: true } },
          },
        }),
      ]);
      for (const b of bills)
        docs.set(
          b.id,
          b.number && b.fiscalYear
            ? billNumber(b.fiscalYear.name, b.number)
            : null,
        );
      for (const i of invoices)
        docs.set(
          i.id,
          i.number && i.fiscalYear
            ? invoiceNumber(i.fiscalYear.name, i.number)
            : null,
        );
    }
    let q = 0n;
    let v = 0n;
    const out = rows.map((r) => {
      q += signed(r.quantity);
      v += r.value;
      const qty = signed(r.quantity);
      return {
        id: r.id,
        itemId: r.itemId,
        item: r.item.name,
        date: iso(r.date),
        kind: r.kind as StockMovementKind,
        document:
          r.sourceId && docs.has(r.sourceId)
            ? { id: r.sourceId, number: docs.get(r.sourceId) ?? null }
            : null,
        quantity: qtyText(qty),
        value: Number(r.value),
        reason: r.reason,
        journalEntry: r.journalEntry && {
          id: r.journalEntry.id,
          number:
            r.journalEntry.number && r.journalEntry.fiscalYear
              ? `JV/${r.journalEntry.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(r.journalEntry.number).padStart(4, '0')}`
              : null,
        },
        undone: r.kind === 'adjustment' && undone.has(r.id),
        onHand: qtyText(q),
        valueOnHand: Number(v),
      };
    });
    return { movements: out };
  }

  /** Each tracked item's quantity, average cost and value on a day, beside what the inventory accounts say */
  async valuation(organizationId: string, asOf?: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    const day = asOf ?? todayIn(timeZone);
    const items = await this.prisma.item.findMany({
      where: { organizationId, trackStock: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        archivedAt: true,
        inventoryAccount: { select: { id: true, code: true, name: true } },
      },
    });
    const stock = await this.onHand(
      this.prisma,
      organizationId,
      undefined,
      day,
    );
    const rows = items
      .map((i) => {
        const s = stock.get(i.id) ?? { quantity: 0n, value: 0n };
        return {
          itemId: i.id,
          name: i.name,
          sku: i.sku,
          unit: i.unit,
          archived: !!i.archivedAt,
          account: i.inventoryAccount,
          quantity: qtyText(s.quantity),
          averageCost: averageUnitCost(s.quantity, s.value),
          value: Number(s.value),
        };
      })
      .filter((r) => !r.archived || r.value || r.quantity !== '0');
    const accountIds = [
      ...new Set(
        items
          .map((i) => i.inventoryAccount?.id)
          .filter((x): x is string => !!x),
      ),
    ];
    const ledger = accountIds.length
      ? await this.prisma.$queryRaw<{ account_id: string; net: bigint }[]>`
          SELECT l.account_id, sum(l.debit - l.credit)::bigint AS net FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date <= ${asDate(day)}::date AND l.account_id = ANY(${accountIds}::uuid[])
          GROUP BY 1`
      : [];
    const accounts = accountIds.map((id) => {
      const a = items.find(
        (i) => i.inventoryAccount?.id === id,
      )!.inventoryAccount!;
      return {
        ...a,
        stock: rows
          .filter((r) => r.account?.id === id)
          .reduce((s, r) => s + r.value, 0),
        ledger: Number(ledger.find((l) => l.account_id === id)?.net ?? 0),
      };
    });
    return {
      asOf: day,
      rows,
      total: rows.reduce((s, r) => s + r.value, 0),
      accounts,
    };
  }
}
