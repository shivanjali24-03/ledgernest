import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocateBatches,
  serialsProblem,
  averageUnitCost,
  batchExpired,
  billNumber,
  creditNoteNumber,
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
type Movement = {
  itemId: string;
  quantity: bigint;
  value: bigint;
  batchId?: string | null;
  sourceLineId?: string | null;
  /** Serial numbers of the units moved (upper-cased) */
  serials?: string[];
};
const upper = (xs: string[] | undefined | null) =>
  (xs ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean);
/** A batch as a bill line or a stock count brings it in */
type BatchIn = {
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
};
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
          trackBatches: boolean;
          trackSerials: boolean;
        }
      >();
    const items = await tx.item.findMany({
      where: { organizationId, id: { in: ids }, trackStock: true },
      select: {
        id: true,
        name: true,
        inventoryAccountId: true,
        cogsAccountId: true,
        trackBatches: true,
        trackSerials: true,
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
          trackBatches: i.trackBatches,
          trackSerials: i.trackSerials,
        },
      ]),
    );
  }

  /** What's on hand in each batch of some items (ten-thousandths) */
  async batchStock(
    tx: Tx | PrismaService,
    organizationId: string,
    itemIds: string[],
  ) {
    if (!itemIds.length) return [];
    const [batches, sums] = await Promise.all([
      tx.stockBatch.findMany({
        where: { organizationId, itemId: { in: itemIds } },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          itemId: true,
          batchNo: true,
          mfgDate: true,
          expiryDate: true,
          createdAt: true,
        },
      }),
      tx.stockMovement.groupBy({
        by: ['batchId'],
        where: {
          organizationId,
          itemId: { in: itemIds },
          batchId: { not: null },
        },
        _sum: { quantity: true },
      }),
    ]);
    const onHand = new Map(
      sums.map((r) => [
        r.batchId!,
        r._sum.quantity ? signed(r._sum.quantity) : 0n,
      ]),
    );
    return batches.map((b) => ({
      id: b.id,
      itemId: b.itemId,
      batchNo: b.batchNo,
      mfgDate: b.mfgDate ? iso(b.mfgDate) : null,
      expiryDate: b.expiryDate ? iso(b.expiryDate) : null,
      receivedAt: b.createdAt.toISOString(),
      onHand: onHand.get(b.id) ?? 0n,
    }));
  }

  /**
   * Stock that has expired or expires within some days, batch by batch, valued at each item's average cost:
   * what to sell first, return to the supplier or write off.
   */
  async expiring(organizationId: string, day: string, days: number) {
    const until = asDate(day);
    until.setUTCDate(until.getUTCDate() + days);
    const batches = await this.prisma.stockBatch.findMany({
      where: {
        organizationId,
        expiryDate: { lte: until },
        item: { archivedAt: null },
      },
      orderBy: [{ expiryDate: 'asc' }, { batchNo: 'asc' }],
      select: {
        id: true,
        batchNo: true,
        mfgDate: true,
        expiryDate: true,
        item: { select: { id: true, name: true, unit: true } },
      },
    });
    const itemIds = [...new Set(batches.map((b) => b.item.id))];
    const [left, stock] = await Promise.all([
      this.batchStock(this.prisma, organizationId, itemIds),
      this.onHand(this.prisma, organizationId, itemIds),
    ]);
    const onHand = new Map(left.map((b) => [b.id, b.onHand]));
    const rows = batches
      .map((b) => {
        const q = onHand.get(b.id) ?? 0n;
        const s = stock.get(b.item.id) ?? { quantity: 0n, value: 0n };
        const expiry = iso(b.expiryDate!);
        return {
          itemId: b.item.id,
          item: b.item.name,
          unit: b.item.unit,
          batchId: b.id,
          batchNo: b.batchNo,
          mfgDate: b.mfgDate ? iso(b.mfgDate) : null,
          expiryDate: expiry,
          daysLeft: Math.round(
            (asDate(expiry).getTime() - asDate(day).getTime()) / 86_400_000,
          ),
          expired: batchExpired(expiry, day),
          q,
          onHand: onHandText(q),
          value: Number(costOfQuantity(s.quantity, s.value, q)),
        };
      })
      .filter((r) => r.q > 0n)
      .map(({ q: _q, ...r }) => r);
    const sum = (expired: boolean) => {
      const x = rows.filter((r) => r.expired === expired);
      return { count: x.length, value: x.reduce((t, r) => t + r.value, 0) };
    };
    return { asOf: day, days, rows, expired: sum(true), expiring: sum(false) };
  }

  /** An item's batches with what's on hand, for choosing one and for the item page */
  async batches(organizationId: string, itemId: string, day: string) {
    const rows = await this.batchStock(this.prisma, organizationId, [itemId]);
    return rows.map((b) => ({
      id: b.id,
      batchNo: b.batchNo,
      mfgDate: b.mfgDate,
      expiryDate: b.expiryDate,
      onHand: onHandText(b.onHand),
      expired: batchExpired(b.expiryDate, day),
    }));
  }

  /**
   * The batch a bill line or stock count brings goods into: found by its number, or made. A batch already known
   * keeps its dates; one given different dates is refused, as it's probably a different batch.
   */
  async batchFor(
    tx: Tx,
    organizationId: string,
    item: { id: string; name: string },
    b: BatchIn,
  ) {
    if (!b.batchNo)
      throw refuse(
        BadRequestException,
        `${item.name} is kept in batches: enter the batch number.`,
        'batch_required',
        { itemId: item.id },
      );
    const found = await tx.stockBatch.findFirst({
      where: {
        organizationId,
        itemId: item.id,
        batchNo: { equals: b.batchNo, mode: 'insensitive' },
      },
    });
    if (found) {
      const differs = (a: Date | null, x: string | null) =>
        !!a && !!x && iso(a) !== x;
      if (
        differs(found.mfgDate, b.mfgDate) ||
        differs(found.expiryDate, b.expiryDate)
      )
        throw refuse(
          ConflictException,
          `Batch ${found.batchNo} of ${item.name} is already recorded with other dates.`,
          'batch_dates_differ',
          { itemId: item.id, batchNo: found.batchNo },
        );
      if ((!found.mfgDate && b.mfgDate) || (!found.expiryDate && b.expiryDate))
        await tx.stockBatch.update({
          where: { id: found.id },
          data: {
            ...(!found.mfgDate && b.mfgDate && { mfgDate: asDate(b.mfgDate) }),
            ...(!found.expiryDate &&
              b.expiryDate && { expiryDate: asDate(b.expiryDate) }),
          },
        });
      return found.id;
    }
    return (
      await tx.stockBatch.create({
        data: {
          organizationId,
          itemId: item.id,
          batchNo: b.batchNo,
          mfgDate: b.mfgDate ? asDate(b.mfgDate) : null,
          expiryDate: b.expiryDate ? asDate(b.expiryDate) : null,
        },
        select: { id: true },
      })
    ).id;
  }

  /** A batch chosen on a draft invoice line must be one of that item's */
  async checkChosenBatches(
    tx: Tx,
    organizationId: string,
    lines: { itemId: string | null; batchId?: string | null }[],
  ) {
    const chosen = lines.filter((l) => l.batchId);
    if (!chosen.length) return;
    const found = await tx.stockBatch.findMany({
      where: { organizationId, id: { in: chosen.map((l) => l.batchId!) } },
      select: { id: true, itemId: true },
    });
    for (const l of chosen)
      if (found.find((b) => b.id === l.batchId)?.itemId !== l.itemId)
        throw refuse(
          BadRequestException,
          'That batch isn’t one of the item’s.',
          'batch_invalid',
          { field: 'batchId' },
        );
  }

  /** A line of goods with serial numbers needs one per unit, none twice */
  private checkSerials(
    item: { id: string; name: string },
    quantity: string,
    serials: string[],
  ) {
    const problem = serialsProblem(quantity, serials);
    if (problem)
      throw refuse(
        BadRequestException,
        problem === 'not_whole'
          ? `${item.name} is sold in whole units, each with its serial number.`
          : problem === 'duplicate'
            ? `A serial number of ${item.name} is entered twice.`
            : `Enter one serial number for each ${item.name}: ${formatQuantity(parseQuantity(quantity) ?? 0n)} needed, ${serials.length} given.`,
        `serials_${problem}`,
        { itemId: item.id },
      );
  }

  /**
   * Where each unit is after some movements: units coming in are in stock (they mustn't be already); units going
   * out must be in stock, and are then sold, written off or removed (a voided bill) by what moved them.
   */
  private async applySerials(
    tx: Tx,
    organizationId: string,
    kind: StockMovementKind,
    movements: Movement[],
  ) {
    for (const m of movements) {
      const serials = upper(m.serials);
      if (!serials.length) continue;
      const rows = await tx.stockSerial.findMany({
        where: { organizationId, itemId: m.itemId, serialNo: { in: serials } },
        select: { id: true, serialNo: true, status: true },
      });
      const found = new Map(rows.map((r) => [r.serialNo, r]));
      if (m.quantity > 0n) {
        const already = rows.find((r) => r.status === 'in_stock');
        if (already)
          throw refuse(
            ConflictException,
            `Serial number ${already.serialNo} is already in stock.`,
            'serial_in_stock',
            { serial: already.serialNo },
          );
        await tx.stockSerial.updateMany({
          where: { organizationId, id: { in: rows.map((r) => r.id) } },
          data: { status: 'in_stock' },
        });
        const fresh = serials.filter((x) => !found.has(x));
        if (fresh.length)
          await tx.stockSerial.createMany({
            data: fresh.map((serialNo) => ({
              organizationId,
              itemId: m.itemId,
              serialNo,
              status: 'in_stock',
            })),
          });
      } else {
        const missing = serials.find(
          (x) => found.get(x)?.status !== 'in_stock',
        );
        if (missing)
          throw refuse(
            ConflictException,
            `Serial number ${missing} isn’t in stock.`,
            'serial_not_in_stock',
            { serial: missing },
          );
        const status =
          kind === 'invoice' || kind === 'credit_note_void'
            ? 'sold'
            : kind === 'adjustment'
              ? 'written_off'
              : 'removed';
        await tx.stockSerial.updateMany({
          where: { organizationId, id: { in: rows.map((r) => r.id) } },
          data: { status },
        });
      }
    }
  }

  /**
   * One serial number's story: the item, where the unit is now, and each movement (bought on a bill, sold on an
   * invoice, returned, written off), for warranty claims and lost or stolen goods.
   */
  async serialHistory(organizationId: string, serial: string) {
    const serialNo = serial.trim().toUpperCase();
    const units = await this.prisma.stockSerial.findMany({
      where: { organizationId, serialNo },
      select: { itemId: true, serialNo: true, status: true },
    });
    const out = [];
    for (const u of units) {
      const moved = await this.prisma.stockMovement.findMany({
        where: { organizationId, itemId: u.itemId, serials: { has: serialNo } },
        select: { id: true },
      });
      const ids = new Set(moved.map((m) => m.id));
      const all = (await this.movements(organizationId, u.itemId)).movements;
      const mine = all.filter((m) => ids.has(m.id));
      const contacts = await this.documentContacts(
        organizationId,
        mine.map((m) => m.document?.id).filter((x): x is string => !!x),
      );
      out.push({
        itemId: u.itemId,
        item: all[0]?.item ?? '',
        serialNo: u.serialNo,
        status: u.status,
        movements: mine.map((m) => ({
          id: m.id,
          date: m.date,
          kind: m.kind,
          document: m.document,
          contact: m.document ? (contacts.get(m.document.id) ?? null) : null,
          reason: m.reason,
        })),
      });
    }
    return out;
  }

  /** The customer or vendor of some invoices, bills and credit notes */
  private async documentContacts(organizationId: string, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const pick = { id: true, contact: { select: { name: true } } } as const;
    const where = { organizationId, id: { in: ids } };
    const [invoices, bills, notes] = await Promise.all([
      this.prisma.invoice.findMany({ where, select: pick }),
      this.prisma.bill.findMany({ where, select: pick }),
      this.prisma.creditNote.findMany({ where, select: pick }),
    ]);
    return new Map(
      [...invoices, ...bills, ...notes].map((d) => [d.id, d.contact.name]),
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
      id?: string;
      itemId: string | null;
      quantity: string;
      costCentreId?: string | null;
      batchId?: string | null;
      serials?: string[];
    }[],
    /** The day it's sold: expired batches can't be */
    day?: string,
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
    const batched = [...items.values()].filter((i) => i.trackBatches);
    const batchLeft = new Map(
      (
        await this.batchStock(
          tx,
          organizationId,
          batched.map((i) => i.id),
        )
      ).map((b) => [b.id, b]),
    );
    const today = day ?? iso(new Date());
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
      if (item.trackBatches) {
        // From the batch chosen, or the earliest-expiring ones; never from an expired batch
        const mine = [...batchLeft.values()].filter(
          (b) => b.itemId === item.id,
        );
        let take: { id: string; quantity: bigint }[];
        if (l.batchId) {
          const b = batchLeft.get(l.batchId);
          if (!b || b.itemId !== item.id)
            throw refuse(
              BadRequestException,
              'That batch isn’t one of the item’s.',
              'batch_invalid',
              { itemId: item.id },
            );
          if (batchExpired(b.expiryDate, today))
            throw refuse(
              ConflictException,
              `Batch ${b.batchNo} of ${item.name} expired on ${b.expiryDate}.`,
              'batch_expired',
              { itemId: item.id, batchNo: b.batchNo },
            );
          if (q > b.onHand)
            throw refuse(
              ConflictException,
              `Only ${onHandText(b.onHand)} of ${item.name} in batch ${b.batchNo}.`,
              'insufficient_batch',
              {
                itemId: item.id,
                batchNo: b.batchNo,
                onHand: onHandText(b.onHand),
              },
            );
          take = [{ id: b.id, quantity: q }];
        } else {
          const a = allocateBatches(mine, q, today);
          if (a.short > 0n)
            throw refuse(
              ConflictException,
              `Only ${onHandText(q - a.short)} of ${item.name} in stock that hasn’t expired.`,
              'insufficient_unexpired',
              { itemId: item.id, onHand: onHandText(q - a.short) },
            );
          take = a.take;
        }
        // The line's cost spread over its batches
        let restQ = q;
        let restV = value;
        for (const t of take) {
          const v = costOfQuantity(restQ, restV, t.quantity);
          restQ -= t.quantity;
          restV -= v;
          const b = batchLeft.get(t.id)!;
          batchLeft.set(t.id, { ...b, onHand: b.onHand - t.quantity });
          movements.push({
            itemId: item.id,
            quantity: -t.quantity,
            value: -v,
            batchId: t.id,
            sourceLineId: l.id ?? null,
          });
        }
      } else {
        if (item.trackSerials)
          this.checkSerials(item, l.quantity, upper(l.serials));
        movements.push({
          itemId: item.id,
          quantity: -q,
          value: -value,
          sourceLineId: l.id ?? null,
          serials: item.trackSerials ? upper(l.serials) : [],
        });
      }
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

  /**
   * For a credit note on goods that came back: each tracked line returns to stock at the cost it left at on the
   * invoice, with the journal lines moving that back from cost of sales to stock.
   */
  async returns(
    tx: Tx,
    organizationId: string,
    invoiceId: string,
    lines: {
      /** The invoice line it credits */
      invoiceLineId?: string;
      itemId: string | null;
      quantity: string;
      costCentreId?: string | null;
      serials?: string[];
    }[],
  ) {
    const items = await this.tracked(
      tx,
      organizationId,
      lines.map((l) => l.itemId),
    );
    const movements: Movement[] = [];
    const journal: EnteredLine[] = [];
    for (const l of lines) {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      if (!item) continue;
      // What the invoice line took out (by batch), or, for invoices from before lines were recorded, the item's
      let sold = l.invoiceLineId
        ? await tx.stockMovement.findMany({
            where: {
              organizationId,
              kind: 'invoice',
              sourceId: invoiceId,
              sourceLineId: l.invoiceLineId,
            },
            orderBy: { createdAt: 'asc' },
            select: {
              quantity: true,
              value: true,
              batchId: true,
              serials: true,
            },
          })
        : [];
      if (!sold.length)
        sold = await tx.stockMovement.findMany({
          where: {
            organizationId,
            kind: 'invoice',
            sourceId: invoiceId,
            itemId: item.id,
          },
          take: 1,
          select: { quantity: true, value: true, batchId: true, serials: true },
        });
      if (!sold.length) continue;
      const soldQ = sold.reduce((x, m) => x - signed(m.quantity), 0n);
      const soldV = sold.reduce((x, m) => x - m.value, 0n);
      const q = parseQuantity(l.quantity)!;
      const value = costOfQuantity(soldQ, soldV, q);
      // Units with serial numbers: which ones came back, each one sold on this line
      if (item.trackSerials) {
        const back = upper(l.serials);
        this.checkSerials(item, l.quantity, back);
        const soldSerials = new Set(sold.flatMap((m) => m.serials ?? []));
        const stranger = back.find((x) => !soldSerials.has(x));
        if (stranger)
          throw refuse(
            BadRequestException,
            `Serial number ${stranger} wasn’t sold on this invoice line.`,
            'serial_not_sold',
            { serial: stranger },
          );
        movements.push({
          itemId: item.id,
          quantity: q,
          value,
          sourceLineId: l.invoiceLineId ?? null,
          serials: back,
        });
        if (value > 0n) {
          const description = `${item.name} returned`;
          journal.push(
            {
              accountId: item.inventoryAccountId,
              description,
              debit: Number(value),
              credit: 0,
            },
            {
              accountId: item.cogsAccountId,
              description,
              debit: 0,
              credit: Number(value),
              costCentreId: l.costCentreId ?? null,
            },
          );
        }
        continue;
      }
      // Back into the batches it left, in order
      let restQ = q;
      let restV = value;
      for (const m of sold) {
        if (restQ <= 0n) break;
        const out = -signed(m.quantity);
        const back = out < restQ ? out : restQ;
        const v =
          m === sold.at(-1) || back === restQ
            ? restV
            : costOfQuantity(restQ, restV, back);
        movements.push({
          itemId: item.id,
          quantity: back,
          value: v,
          batchId: m.batchId,
          sourceLineId: l.invoiceLineId ?? null,
        });
        restQ -= back;
        restV -= v;
      }
      if (value > 0n) {
        const description = `${item.name} returned`;
        journal.push(
          {
            accountId: item.inventoryAccountId,
            description,
            debit: Number(value),
            credit: 0,
          },
          {
            accountId: item.cogsAccountId,
            description,
            debit: 0,
            credit: Number(value),
            costCentreId: l.costCentreId ?? null,
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
    lines: ({
      id?: string;
      itemId: string | null;
      quantity: string;
      value: number;
      serials?: string[];
    } & Partial<BatchIn>)[],
  ) {
    const items = await this.tracked(
      tx,
      organizationId,
      lines.map((l) => l.itemId),
    );
    const out: Movement[] = [];
    for (const l of lines) {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      if (!item) continue;
      if (item.trackSerials)
        this.checkSerials(item, l.quantity, upper(l.serials));
      out.push({
        itemId: item.id,
        quantity: parseQuantity(l.quantity)!,
        value: BigInt(l.value),
        serials: item.trackSerials ? upper(l.serials) : [],
        batchId: item.trackBatches
          ? await this.batchFor(tx, organizationId, item, {
              batchNo: l.batchNo ?? null,
              mfgDate: l.mfgDate ?? null,
              expiryDate: l.expiryDate ?? null,
            })
          : null,
        sourceLineId: l.id ?? null,
      });
    }
    return out;
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
        batchId: x.batchId ?? null,
        sourceLineId: x.sourceLineId ?? null,
        serials: upper(x.serials),
      })),
    });
    await this.applySerials(tx, organizationId, m.kind, movements);
  }

  /**
   * Voiding a bill or invoice: its stock movements are put back. Stock from a bill can only go back while it's
   * still on hand.
   */
  async undoDocument(
    tx: Tx,
    organizationId: string,
    kind: 'bill' | 'invoice' | 'credit_note',
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
        batchId: true,
        sourceLineId: true,
        serials: true,
        item: { select: { name: true } },
        batch: { select: { batchNo: true } },
      },
    });
    if (!done.length) return;
    await this.lock(tx, organizationId);
    // Stock that came in (a bill, goods returned) can only go out again while it's still on hand
    if (kind === 'bill' || kind === 'credit_note') {
      const stock = await this.onHand(tx, organizationId, [
        ...new Set(done.map((d) => d.itemId)),
      ]);
      for (const d of done) {
        const s = stock.get(d.itemId)!;
        const q = signed(d.quantity);
        if (q > s.quantity)
          throw refuse(
            ConflictException,
            `Some of the ${d.item.name} has been sold or written off since.`,
            'stock_used',
            { itemId: d.itemId },
          );
        stock.set(d.itemId, {
          quantity: s.quantity - q,
          value: s.value - d.value,
        });
      }
      // And from the same batch
      const batched = done.filter((d) => d.batchId);
      if (batched.length) {
        const left = new Map(
          (
            await this.batchStock(tx, organizationId, [
              ...new Set(batched.map((d) => d.itemId)),
            ])
          ).map((b) => [b.id, b.onHand]),
        );
        for (const d of batched) {
          const q = signed(d.quantity);
          const have = left.get(d.batchId!) ?? 0n;
          if (q > have)
            throw refuse(
              ConflictException,
              `Some of batch ${d.batch!.batchNo} of ${d.item.name} has been sold or written off since.`,
              'stock_used',
              { itemId: d.itemId },
            );
          left.set(d.batchId!, have - q);
        }
      }
    }
    await this.save(
      tx,
      organizationId,
      {
        kind: `${kind}_void`,
        sourceId,
        date,
        journalEntryId,
        actorId,
      },
      done.map((d) => ({
        itemId: d.itemId,
        quantity: -signed(d.quantity),
        value: -d.value,
        batchId: d.batchId,
        sourceLineId: d.sourceLineId,
        serials: d.serials,
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
          trackBatches: true,
          trackSerials: true,
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
      // Goods kept in batches are counted batch by batch: new stock into its batch, a write-off from one that has it
      let batchId: string | null = null;
      const serials = item.trackSerials ? upper(input.serials) : [];
      if (item.trackSerials) this.checkSerials(item, input.quantity, serials);
      if (item.trackBatches) {
        if (input.direction === 'in')
          batchId = await this.batchFor(tx, organizationId, item, input);
        else {
          if (!input.batchNo)
            throw refuse(
              BadRequestException,
              `${item.name} is kept in batches: enter the batch number.`,
              'batch_required',
              { field: 'batchNo' },
            );
          const b = (await this.batchStock(tx, organizationId, [item.id])).find(
            (x) => x.batchNo.toLowerCase() === input.batchNo!.toLowerCase(),
          );
          if (!b || q > b.onHand)
            throw refuse(
              ConflictException,
              `Only ${onHandText(b?.onHand ?? 0n)} of ${item.name} in batch ${input.batchNo}.`,
              'insufficient_batch',
              { field: 'quantity' },
            );
          batchId = b.id;
        }
      }
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
          batchId,
          serials,
        },
        select: { id: true },
      });
      await this.applySerials(tx, organizationId, 'adjustment', [
        {
          itemId: item.id,
          quantity: input.direction === 'out' ? -q : q,
          value,
          serials,
        },
      ]);
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
          batchId: true,
          serials: true,
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
        const inBatch = m.batchId
          ? ((await this.batchStock(tx, organizationId, [m.itemId])).find(
              (b) => b.id === m.batchId,
            )?.onHand ?? 0n)
          : q;
        if (q > s.quantity || q > inBatch)
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
          batchId: m.batchId,
          serials: m.serials,
        },
      });
      await this.applySerials(tx, organizationId, 'adjustment_undo', [
        { itemId: m.itemId, quantity: -q, value: -m.value, serials: m.serials },
      ]);
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
        [
          'bill',
          'bill_void',
          'invoice',
          'invoice_void',
          'credit_note',
          'credit_note_void',
        ].includes(x.kind),
    ))
      docs.set(r.sourceId!, null);
    if (docs.size) {
      const ids = [...docs.keys()];
      const [bills, invoices, notes] = await Promise.all([
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
            fullNumber: true,
          },
        }),
        this.prisma.creditNote.findMany({
          where: { organizationId, id: { in: ids } },
          select: {
            id: true,
            number: true,
            fiscalYear: { select: { name: true } },
            fullNumber: true,
          },
        }),
      ]);
      for (const c of notes)
        docs.set(
          c.id,
          c.fullNumber ?? creditNoteNumber(c.fiscalYear.name, c.number),
        );
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
            ? (i.fullNumber ?? invoiceNumber(i.fiscalYear.name, i.number))
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
        reorderLevel: true,
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
          reorderLevel:
            i.reorderLevel === null
              ? null
              : qtyText(tenThousandths(i.reorderLevel)),
          low:
            i.reorderLevel !== null &&
            s.quantity <= tenThousandths(i.reorderLevel),
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
