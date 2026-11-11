import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  currencyDigits,
  formatQuantity,
  pdfTableBytes,
  quoteRows,
  invoiceNumber,
  parseQuantity,
  QUOTE_MOVES,
  quoteEditable,
  quoteNumber,
  quoteState,
  todayIn,
  type quoteDraftSchema,
  type quoteEmailSchema,
  type QuoteStatus,
  parseQuoteNumber,
  jobWorkDeadline,
  type challanDispatchSchema,
  CHALLAN_PURPOSE_TEXT,
  INDIAN_STATES,
  INVOICE_COPIES,
  type ChallanPurpose,
  type InvoiceCopy,
  QUOTE_TITLES,
  type QuoteKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { MailService } from '../mail/mail.service.js';
import { InvoicesService, type DraftIn } from '../invoices/invoices.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { JournalsService } from '../journals/journals.service.js';
import { organizationLogo } from '../common/pdf-logo.js';
import { organizationSender } from '../common/reply-to.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Input = z.output<typeof quoteDraftSchema>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const select = {
  id: true,
  number: true,
  kind: true,
  purpose: true,
  status: true,
  quoteDate: true,
  expiryDate: true,
  currency: true,
  placeOfSupply: true,
  warehouseId: true,
  warehouse: { select: { id: true, name: true } },
  reference: true,
  notes: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  sentAt: true,
  dispatchedAt: true,
  backAt: true,
  backReason: true,
  decidedAt: true,
  decidedBy: true,
  decisionNote: true,
  shareToken: true,
  shareViews: true,
  shareViewedAt: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { id: true, name: true, email: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      status: true,
      fiscalYear: { select: { name: true } },
      fullNumber: true,
    },
  },
  lines: {
    orderBy: { lineNo: 'asc' },
    select: {
      id: true,
      lineNo: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPpm: true,
      amount: true,
      taxAmount: true,
      item: {
        select: { id: true, name: true, trackStock: true, trackSerials: true },
      },
      account: { select: { id: true, code: true, name: true } },
      taxGroup: { select: { id: true, name: true } },
      costCentre: { select: { id: true, code: true, name: true } },
    },
  },
} as const;
type Row = Prisma.QuoteGetPayload<{ select: typeof select }>;

/**
 * Quotes (estimates) for customers. They're priced exactly as invoices are (the invoice rules check the lines,
 * pick accounts and switch GST by place of supply) but post nothing. One becomes a draft invoice with the same
 * lines, in the same transaction that marks it invoiced; deleting that draft puts the quote back to accepted.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly mail: MailService,
    private readonly webhooks: WebhooksService,
    private readonly journals: JournalsService,
    private readonly inventory: InventoryService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quotes:' + organizationId}))`;
  }

  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return todayIn(timeZone);
  }

  private view(q: Row, today: string) {
    const status = q.status as QuoteStatus;
    const expiryDate = iso(q.expiryDate);
    return {
      id: q.id,
      /** A quotation, proforma invoice or sales order */
      kind: q.kind as QuoteKind,
      /** A delivery challan's reason (Rule 55) */
      purpose: (q.purpose as ChallanPurpose | null) ?? null,
      number: quoteNumber(q.number, q.kind as QuoteKind),
      status,
      state: quoteState({ status, expiryDate }, today),
      quoteDate: iso(q.quoteDate),
      expiryDate,
      currency: q.currency,
      placeOfSupply: q.placeOfSupply,
      /** A challan's goods leave this warehouse (null: the main one) */
      warehouse: q.warehouse,
      reference: q.reference,
      notes: q.notes,
      contact: q.contact,
      subtotal: Number(q.subtotal),
      taxTotal: Number(q.taxTotal),
      total: Number(q.total),
      invoice: q.invoice && {
        id: q.invoice.id,
        number:
          q.invoice.number && q.invoice.fiscalYear
            ? (q.invoice.fullNumber ??
              invoiceNumber(q.invoice.fiscalYear.name, q.invoice.number))
            : null,
        status: q.invoice.status,
      },
      sentAt: q.sentAt,
      /** A delivery challan's goods: when they left stock, and when they came back (invoiced or returned) */
      goods:
        q.kind === 'delivery_challan'
          ? {
              dispatchedAt: q.dispatchedAt ? iso(q.dispatchedAt) : null,
              backAt: q.backAt ? iso(q.backAt) : null,
              backReason:
                (q.backReason as 'invoiced' | 'returned' | null) ?? null,
              // Goods out for job work must come back within a year, or they count as supplied (s.143)
              jobWorkDue:
                q.purpose === 'job_work' && q.dispatchedAt && !q.backAt
                  ? jobWorkDeadline(iso(q.dispatchedAt))
                  : null,
            }
          : null,
      decidedAt: q.decidedAt,
      /** Set when the customer answered from their link */
      decidedBy: q.decidedBy,
      decisionNote: q.decisionNote,
      /** The customer's link, and how often it was opened */
      share: q.shareToken
        ? {
            token: q.shareToken,
            views: q.shareViews,
            lastViewedAt: q.shareViewedAt,
          }
        : null,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      lines: q.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
        unitPrice: Number(l.unitPrice),
        discount: l.discountPpm / 10_000,
        amount: Number(l.amount),
        taxAmount: Number(l.taxAmount),
        item: l.item,
        account: l.account,
        taxGroup: l.taxGroup,
        costCentre: l.costCentre,
      })),
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const q = await tx.quote.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!q) throw new NotFoundException('Quote not found.');
    return q;
  }

  async get(organizationId: string, id: string) {
    return this.view(
      await this.find(this.prisma, organizationId, id),
      await this.today(organizationId),
    );
  }

  async list(
    organizationId: string,
    q: {
      kind?: QuoteKind;
      state?: string;
      contactId?: string;
      search?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const today = asDate(await this.today(organizationId));
    const parsed = q.search ? parseQuoteNumber(q.search) : null;
    const open = { status: { in: ['draft', 'sent'] } };
    const byState: Record<string, Prisma.QuoteWhereInput> = {
      open: { ...open, expiryDate: { gte: today } },
      expired: { ...open, expiryDate: { lt: today } },
    };
    const where: Prisma.QuoteWhereInput = {
      organizationId,
      ...(q.kind && { kind: q.kind }),
      ...(q.state && (byState[q.state] ?? { status: q.state })),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.search && {
        OR: [
          { reference: { contains: q.search, mode: 'insensitive' } },
          { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          ...(parsed
            ? [
                {
                  number: parsed.number,
                  ...(parsed.kind && { kind: parsed.kind }),
                },
              ]
            : []),
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.quote.count({ where }),
      this.prisma.quote.findMany({
        where,
        orderBy: [{ quoteDate: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
    ]);
    const day = iso(today);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => {
        const { lines: _lines, ...rest } = this.view(r, day);
        return rest;
      }),
    };
  }

  /** The invoice rules price the lines; nothing is saved by them */
  private price(organizationId: string, input: Input) {
    return this.invoices.price(organizationId, {
      contactId: input.contactId,
      issueDate: input.quoteDate,
      dueDate: input.expiryDate,
      reference: input.reference,
      notes: input.notes,
      placeOfSupply: input.placeOfSupply,
      receivableAccountId: null,
      rate: null,
      lines: input.lines,
    });
  }

  private async writeLines(
    tx: Tx,
    organizationId: string,
    quoteId: string,
    p: Awaited<ReturnType<QuotesService['price']>>,
  ) {
    await tx.quoteLine.deleteMany({ where: { quoteId } });
    await tx.quoteLine.createMany({
      data: p.lines.map((l, n) => ({
        organizationId,
        quoteId,
        lineNo: n + 1,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: BigInt(l.unitPrice),
        discountPpm: l.discount,
        taxGroupId: l.group?.id ?? null,
        accountId: l.accountId,
        costCentreId: l.costCentreId ?? null,
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
      // Each kind numbers on its own: QT-0001, PI-0001, SO-0001
      const kind: QuoteKind = input.kind ?? 'quote';
      const last = await tx.quote.aggregate({
        where: { organizationId, kind },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const q = await tx.quote.create({
        data: {
          organizationId,
          number,
          kind,
          purpose: kind === 'delivery_challan' ? input.purpose : null,
          contactId: p.contactId,
          quoteDate: asDate(input.quoteDate),
          expiryDate: asDate(input.expiryDate),
          currency: p.currency,
          placeOfSupply: p.placeOfSupply,
          warehouseId: input.warehouseId
            ? await this.inventory.warehouseFor(
                tx,
                organizationId,
                input.warehouseId,
              )
            : null,
          reference: input.reference,
          notes: input.notes,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.writeLines(tx, organizationId, q.id, p);
      await this.audit.record(
        {
          action: 'org.quote.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: q.id,
          after: {
            number: quoteNumber(number, kind),
            contactId: p.contactId,
            total: p.amounts.total,
            currency: p.currency,
          },
          req: ctx.req,
        },
        tx,
      );
      return q.id;
    });
    return this.get(organizationId, id);
  }

  async update(id: string, input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(this.prisma, organizationId, id);
    if (!quoteEditable(before.status as QuoteStatus))
      throw refuse(
        ConflictException,
        'Only draft and sent quotes can change.',
        'not_editable',
      );
    const p = await this.price(organizationId, input);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const now = await this.find(tx, organizationId, id);
      if (!quoteEditable(now.status as QuoteStatus))
        throw refuse(
          ConflictException,
          'Only draft and sent quotes can change.',
          'not_editable',
        );
      await tx.quote.update({
        where: { id },
        data: {
          contactId: p.contactId,
          ...(now.kind === 'delivery_challan' && input.purpose
            ? { purpose: input.purpose }
            : {}),
          quoteDate: asDate(input.quoteDate),
          expiryDate: asDate(input.expiryDate),
          currency: p.currency,
          placeOfSupply: p.placeOfSupply,
          warehouseId: input.warehouseId
            ? await this.inventory.warehouseFor(
                tx,
                organizationId,
                input.warehouseId,
              )
            : null,
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
          action: 'org.quote.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          before: { total: Number(before.total), contact: before.contact.name },
          after: { total: p.amounts.total, lines: p.lines.length },
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
      await this.lock(tx, organizationId);
      const q = await this.find(tx, organizationId, id);
      if (q.status !== 'draft')
        throw refuse(
          ConflictException,
          'Only draft quotes can be deleted. Decline it instead.',
          'not_draft',
        );
      await tx.documentAttachment.deleteMany({
        where: { organizationId, documentType: 'quote', documentId: id },
      });
      await tx.quote.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.quote.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          before: {
            number: quoteNumber(q.number, q.kind as QuoteKind),
            contact: q.contact.name,
            total: Number(q.total),
          },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** Sent, accepted, declined, or back to draft: only the moves QUOTE_MOVES allows */
  async move(id: string, status: QuoteStatus, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const q = await this.find(tx, organizationId, id);
      const from = q.status as QuoteStatus;
      // Goods are out on it: it can't be reworked until they're back
      if (status === 'draft' && q.dispatchedAt && !q.backAt)
        throw refuse(
          ConflictException,
          'The goods on this challan have left. Record them coming back first.',
          'challan_dispatched',
        );
      if (!QUOTE_MOVES[from].includes(status))
        throw refuse(
          ConflictException,
          `A ${from} quote can’t become ${status}.`,
          'bad_move',
          { from, to: status },
        );
      const now = new Date();
      await tx.quote.update({
        where: { id },
        data: {
          status,
          ...(status === 'sent' && !q.sentAt && { sentAt: now }),
          ...(status === 'accepted' || status === 'declined'
            ? { decidedAt: now }
            : { decidedAt: null }),
        },
      });
      await this.audit.record(
        {
          action: `org.quote.${status === 'draft' ? 'reopen' : status === 'sent' ? 'send' : status === 'accepted' ? 'accept' : 'decline'}`,
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          before: { status: from },
          after: { status },
          req: ctx.req,
        },
        tx,
      );
    });
    const moved = await this.get(organizationId, id);
    if (status !== 'draft')
      void this.webhooks.emit(
        organizationId,
        `quote.${status}`,
        moved,
        ctx.actor.userId,
      );
    return moved;
  }

  /**
   * A new draft of another kind with the same lines: a quote accepted becomes a sales order, or a proforma to ask
   * for an advance. Dated today, valid as long as the original was; its reference is the original's number.
   */
  async copy(id: string, kind: QuoteKind, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const q = await this.find(this.prisma, organizationId, id);
    const today = await this.today(organizationId);
    const days = Math.round(
      (q.expiryDate.getTime() - q.quoteDate.getTime()) / 86_400_000,
    );
    return this.create(
      {
        contactId: q.contact.id,
        kind,
        // A challan made from another document says why the goods move; it can be changed while a draft
        purpose: kind === 'delivery_challan' ? 'other' : null,
        quoteDate: today,
        expiryDate: iso(new Date(asDate(today).getTime() + days * 86_400_000)),
        reference: quoteNumber(q.number, q.kind as QuoteKind),
        notes: q.notes,
        placeOfSupply: q.placeOfSupply,
        lines: q.lines.map((l) => ({
          itemId: l.item?.id ?? null,
          description: l.description,
          quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
          unitPrice: Number(l.unitPrice),
          discount: l.discountPpm,
          taxGroupId: l.taxGroup?.id ?? null,
          accountId: l.account?.id ?? null,
          costCentreId: l.costCentre?.id ?? null,
        })),
      } as Input,
      ctx,
    );
  }

  /**
   * A delivery challan's goods leave stock, at average cost, to "goods sent on challan": still ours, not on hand.
   * A draft challan is marked sent. Lines can name the batch and the units by serial number.
   */
  async dispatch(
    id: string,
    input: z.output<typeof challanDispatchSchema>,
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const date = input.date ?? (await this.today(organizationId));
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const q = await this.find(tx, organizationId, id);
      const label = quoteNumber(q.number, q.kind as QuoteKind);
      if (q.kind !== 'delivery_challan')
        throw refuse(
          BadRequestException,
          'Only delivery challans move goods.',
          'not_challan',
        );
      if (q.dispatchedAt)
        throw refuse(
          ConflictException,
          'The goods on this challan have already left.',
          'challan_dispatched',
        );
      if (q.status === 'invoiced' || q.status === 'declined')
        throw refuse(
          ConflictException,
          q.status === 'invoiced'
            ? 'This challan is already an invoice: the goods leave with it.'
            : 'This challan was declined.',
          q.status === 'invoiced' ? 'already_invoiced' : 'declined',
        );
      if (date < iso(q.quoteDate))
        throw refuse(
          BadRequestException,
          'The goods can’t leave before the challan’s date.',
          'before_challan',
          { field: 'date' },
        );
      const given = new Map(input.lines.map((l) => [l.quoteLineId, l]));
      const stranger = input.lines.find(
        (l) => !q.lines.some((x) => x.id === l.quoteLineId),
      );
      if (stranger)
        throw refuse(
          BadRequestException,
          'A line isn’t on this challan.',
          'line_not_found',
        );
      const out = await this.inventory.challanOut(
        tx,
        organizationId,
        q.lines.map((l) => ({
          id: l.id,
          itemId: l.item?.id ?? null,
          quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
          batchId: given.get(l.id)?.batchId ?? null,
          serials: given.get(l.id)?.serials ?? [],
        })),
        date,
        q.warehouseId,
      );
      if (!out.movements.length)
        throw refuse(
          BadRequestException,
          'Nothing on this challan is kept in stock.',
          'no_stock_goods',
        );
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date,
          memo: `Delivery challan ${label} · ${q.contact.name}`,
          reference: label,
          lines: out.journal,
        },
        ctx.actor.userId,
      );
      await this.inventory.save(
        tx,
        organizationId,
        {
          kind: 'challan_out',
          sourceId: id,
          date,
          journalEntryId: entry.id,
          actorId: ctx.actor.userId,
        },
        out.movements,
      );
      await tx.quote.update({
        where: { id },
        data: {
          dispatchedAt: asDate(date),
          dispatchEntryId: entry.id,
          ...(q.status === 'draft' && { status: 'sent', sentAt: new Date() }),
        },
      });
      await this.audit.record(
        {
          action: 'org.quote.dispatch',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          after: { number: label, date, entry: entry.number },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** A delivery challan's goods came back: into stock exactly as they left, out of "goods sent on challan" */
  async goodsBack(id: string, input: { date?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const date = input.date ?? (await this.today(organizationId));
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const q = await this.find(tx, organizationId, id);
      const label = quoteNumber(q.number, q.kind as QuoteKind);
      if (!q.dispatchedAt || q.backAt)
        throw refuse(
          ConflictException,
          q.backAt
            ? 'The goods on this challan are already back.'
            : 'The goods on this challan haven’t left.',
          q.backAt ? 'challan_back' : 'challan_not_dispatched',
        );
      if (date < iso(q.dispatchedAt))
        throw refuse(
          BadRequestException,
          'Goods can’t come back before they left.',
          'before_dispatch',
          { field: 'date' },
        );
      const back = await this.inventory.challanBack(tx, organizationId, id);
      const entry = back.journal.length
        ? await this.journals.postEntryInTx(
            tx,
            organizationId,
            {
              date,
              memo: `Goods back on ${label} · ${q.contact.name}`,
              reference: label,
              lines: back.journal,
            },
            ctx.actor.userId,
          )
        : null;
      await this.inventory.save(
        tx,
        organizationId,
        {
          kind: 'challan_back',
          sourceId: id,
          date,
          journalEntryId: entry?.id ?? null,
          actorId: ctx.actor.userId,
        },
        back.movements,
      );
      await tx.quote.update({
        where: { id },
        data: {
          backAt: asDate(date),
          backReason: 'returned',
          backEntryId: entry?.id ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'org.quote.goods_back',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          after: { number: label, date, entry: entry?.number ?? null },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** A draft invoice with the quote's lines, dated today unless another day is given */
  async convert(id: string, input: { issueDate?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const q = await this.find(this.prisma, organizationId, id);
    const status = q.status as QuoteStatus;
    if (status === 'invoiced' || status === 'declined')
      throw refuse(
        ConflictException,
        status === 'invoiced'
          ? 'This quote is already an invoice.'
          : 'A declined quote can’t be invoiced. Mark it accepted first.',
        status === 'invoiced' ? 'already_invoiced' : 'declined',
      );
    const draft: DraftIn = {
      contactId: q.contact.id,
      issueDate: input.issueDate ?? (await this.today(organizationId)),
      dueDate: null,
      reference: q.reference ?? quoteNumber(q.number, q.kind as QuoteKind),
      notes: q.notes,
      placeOfSupply: q.placeOfSupply,
      warehouseId: q.warehouseId,
      receivableAccountId: null,
      rate: null,
      lines: q.lines.map((l) => ({
        itemId: l.item?.id ?? null,
        description: l.description,
        quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
        unitPrice: Number(l.unitPrice),
        discount: l.discountPpm,
        taxGroupId: l.taxGroup?.id ?? null,
        accountId: l.account?.id ?? null,
        costCentreId: l.costCentre?.id ?? null,
      })),
    };
    const invoice = await this.invoices.createDraft(
      draft,
      ctx,
      async (tx, invoiceId) => {
        await this.lock(tx, organizationId);
        // Someone else may have invoiced it in the meantime
        const done = await tx.quote.updateMany({
          where: {
            id,
            organizationId,
            status: { notIn: ['invoiced', 'declined'] },
          },
          data: { status: 'invoiced', invoiceId, decidedAt: new Date() },
        });
        if (done.count !== 1)
          throw refuse(
            ConflictException,
            'This quote is already an invoice.',
            'already_invoiced',
          );
        await this.audit.record(
          {
            action: 'org.quote.invoice',
            actorId: ctx.actor.userId,
            organizationId,
            entityType: 'quote',
            entityId: id,
            before: { status },
            after: { status: 'invoiced', invoiceId },
            req: ctx.req,
          },
          tx,
        );
      },
    );
    const done = await this.get(organizationId, id);
    void this.webhooks.emit(
      organizationId,
      'quote.invoiced',
      { ...done, invoiceId: invoice.id },
      ctx.actor.userId,
    );
    return { quote: done, invoiceId: invoice.id };
  }

  /** A quote as a PDF: lines, totals, valid-until date and the organisation's terms */
  private async pdf(
    organizationId: string,
    q: Awaited<ReturnType<QuotesService['get']>>,
    copy?: InvoiceCopy,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        taxId: true,
        baseCurrency: true,
        invoiceTerms: true,
      },
    });
    const challan = q.kind === 'delivery_challan';
    const pos = INDIAN_STATES.find((x) => x.code === q.placeOfSupply);
    const currency = q.currency ?? org.baseCurrency;
    const logo = await organizationLogo(this.prisma, organizationId);
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        title: `${QUOTE_TITLES[q.kind]} ${q.number}`,
        subtitle: challan
          ? // Rule 55: the consignor and consignee with their GSTINs, the date, and each copy marked
            `${org.legalName ?? org.name}${org.taxId ? ` · GSTIN ${org.taxId}` : ''} to ${q.contact.name} · ${q.quoteDate}${copy ? ` · ${INVOICE_COPIES[copy].replace('RECIPIENT', 'CONSIGNEE').replace('SUPPLIER', 'CONSIGNOR')}` : ''}`
          : `${org.name} for ${q.contact.name} · ${q.quoteDate}${q.kind === 'sales_order' ? '' : `, valid until ${q.expiryDate}`}${q.reference ? ` · ${q.reference}` : ''}`,
        after: [
          ...(challan
            ? [
                `Purpose: ${q.purpose ? CHALLAN_PURPOSE_TEXT[q.purpose] : 'Movement of goods'}`,
                ...(pos ? [`Place of supply: ${pos.name} (${pos.code})`] : []),
                'Not a tax invoice: goods moved on a delivery challan under rule 55 of the CGST Rules.',
                ...(q.reference ? [`Reference: ${q.reference}`] : []),
                '',
                `For ${org.legalName ?? org.name}`,
                '',
                '',
                'Authorised signatory',
              ]
            : []),
          // A proforma asks for payment: it isn't a tax invoice, which follows when the goods or services are supplied
          ...(q.kind === 'proforma'
            ? [
                'This is a proforma invoice, not a tax invoice. A tax invoice follows on supply.',
              ]
            : []),
          ...(org.invoiceTerms ? org.invoiceTerms.split(/\r?\n/) : []),
        ],
        footer: `${org.name} · ${q.number}`,
        rows: quoteRows({ ...q, currency }, currencyDigits(currency)),
      }),
    );
    return { org, pdf, currency };
  }

  /** The PDF of a quote, to download */
  async download(organizationId: string, id: string, copy?: InvoiceCopy) {
    const q = await this.get(organizationId, id);
    const { pdf } = await this.pdf(organizationId, q, copy);
    return {
      data: pdf,
      fileName: `${q.kind.replace('_', '-')}-${q.number.toLowerCase()}.pdf`,
    };
  }

  /** The quote as a PDF to the customer (or the address given); a draft is marked sent */
  async email(id: string, input: z.output<typeof quoteEmailSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const q = await this.get(organizationId, id);
    if (q.status === 'declined' || q.status === 'invoiced')
      throw refuse(
        ConflictException,
        'Only open or accepted quotes can be emailed.',
        'not_sendable',
      );
    if (!this.mail.configured)
      throw refuse(
        ConflictException,
        'Email isn’t set up on this server. Print the quote and send it yourself.',
        'mail_off',
      );
    const to = input.email ?? q.contact.email;
    if (!to)
      throw refuse(
        BadRequestException,
        'This customer has no email address. Enter one to send it to.',
        'no_email',
      );
    const { org, pdf, currency } = await this.pdf(organizationId, q);
    const sent = await this.mail.send({
      ...(await organizationSender(this.prisma, organizationId)),
      to: [to],
      subject: `Quote ${q.number} from ${org.name}`,
      text: [
        `Dear ${q.contact.name},`,
        ...(input.message ? [input.message] : []),
        `Please find our quote ${q.number} attached: ${currency} ${(q.total / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency))} in all, valid until ${q.expiryDate}.`,
        ...(q.notes ? [q.notes] : []),
        org.name,
      ].join('\n\n'),
      attachments: [
        {
          filename: `quote-${q.number.toLowerCase()}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
    if (!sent)
      throw refuse(
        ConflictException,
        'The email couldn’t be sent. Try again later.',
        'mail_failed',
      );
    await this.prisma.$transaction(async (tx) => {
      if (q.status === 'draft')
        await tx.quote.updateMany({
          where: { id, organizationId, status: 'draft' },
          data: { status: 'sent', sentAt: new Date() },
        });
      await this.audit.record(
        {
          action: 'org.quote.email',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          after: { number: q.number, email: to, total: q.total },
          req: ctx.req,
        },
        tx,
      );
    });
    const after = await this.get(organizationId, id);
    if (q.status === 'draft')
      void this.webhooks.emit(
        organizationId,
        'quote.sent',
        after,
        ctx.actor.userId,
      );
    return { sentTo: to, quote: after };
  }
}
