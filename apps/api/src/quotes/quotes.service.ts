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
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { MailService } from '../mail/mail.service.js';
import { InvoicesService, type DraftIn } from '../invoices/invoices.service.js';
import { organizationLogo } from '../common/pdf-logo.js';
import { organizationReplyTo } from '../common/reply-to.js';
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
  status: true,
  quoteDate: true,
  expiryDate: true,
  currency: true,
  placeOfSupply: true,
  reference: true,
  notes: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  sentAt: true,
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
      item: { select: { id: true, name: true } },
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
      number: quoteNumber(q.number),
      status,
      state: quoteState({ status, expiryDate }, today),
      quoteDate: iso(q.quoteDate),
      expiryDate,
      currency: q.currency,
      placeOfSupply: q.placeOfSupply,
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
            ? invoiceNumber(q.invoice.fiscalYear.name, q.invoice.number)
            : null,
        status: q.invoice.status,
      },
      sentAt: q.sentAt,
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
      state?: string;
      contactId?: string;
      search?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const today = asDate(await this.today(organizationId));
    const open = { status: { in: ['draft', 'sent'] } };
    const byState: Record<string, Prisma.QuoteWhereInput> = {
      open: { ...open, expiryDate: { gte: today } },
      expired: { ...open, expiryDate: { lt: today } },
    };
    const where: Prisma.QuoteWhereInput = {
      organizationId,
      ...(q.state && (byState[q.state] ?? { status: q.state })),
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.search && {
        OR: [
          { reference: { contains: q.search, mode: 'insensitive' } },
          { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          ...(/^(QT-)?\d+$/i.test(q.search)
            ? [{ number: Number(q.search.replace(/^QT-/i, '')) }]
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
      const last = await tx.quote.aggregate({
        where: { organizationId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const q = await tx.quote.create({
        data: {
          organizationId,
          number,
          contactId: p.contactId,
          quoteDate: asDate(input.quoteDate),
          expiryDate: asDate(input.expiryDate),
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
      await this.writeLines(tx, organizationId, q.id, p);
      await this.audit.record(
        {
          action: 'org.quote.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: q.id,
          after: {
            number: quoteNumber(number),
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
          quoteDate: asDate(input.quoteDate),
          expiryDate: asDate(input.expiryDate),
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
            number: quoteNumber(q.number),
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
      reference: q.reference ?? quoteNumber(q.number),
      notes: q.notes,
      placeOfSupply: q.placeOfSupply,
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
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, baseCurrency: true, invoiceTerms: true },
    });
    const currency = q.currency ?? org.baseCurrency;
    const logo = await organizationLogo(this.prisma, organizationId);
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        title: `Quote ${q.number}`,
        subtitle: `${org.name} for ${q.contact.name} · ${q.quoteDate}, valid until ${q.expiryDate}${q.reference ? ` · ${q.reference}` : ''}`,
        after: org.invoiceTerms ? org.invoiceTerms.split(/\r?\n/) : undefined,
        footer: `${org.name} · ${q.number}`,
        rows: quoteRows({ ...q, currency }, currencyDigits(currency)),
      }),
    );
    return { org, pdf, currency };
  }

  /** The PDF of a quote, to download */
  async download(organizationId: string, id: string) {
    const q = await this.get(organizationId, id);
    const { pdf } = await this.pdf(organizationId, q);
    return { data: pdf, fileName: `quote-${q.number.toLowerCase()}.pdf` };
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
      replyTo: await organizationReplyTo(this.prisma, organizationId),
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
