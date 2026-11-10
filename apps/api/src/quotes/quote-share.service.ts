import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  quoteNumber,
  quoteState,
  todayIn,
  type QuoteStatus,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { SHARE_TOKEN } from '../invoices/invoice-share.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotesService } from './quotes.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A quote's link for its customer: they open it without an account, see the lines and totals, download the PDF, and
 * accept or decline it while it's open. Sharing a draft sends it. Revocable, counted, audited.
 */
@Injectable()
export class QuoteShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quotes: QuotesService,
    private readonly webhooks: WebhooksService,
  ) {}

  async share(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const q = await this.prisma.quote.findFirst({
      where: { organizationId, id },
      select: { status: true, number: true, shareToken: true },
    });
    if (!q) throw new NotFoundException('Quote not found.');
    if (q.status === 'invoiced' || q.status === 'declined')
      throw new ConflictException({
        message: 'Only open or accepted quotes can be shared.',
        details: { reason: 'not_sendable' },
      });
    if (q.shareToken) return this.quotes.get(organizationId, id);
    const token = randomBytes(24).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id },
        data: {
          shareToken: token,
          shareViews: 0,
          shareViewedAt: null,
          // Shared is sent
          ...(q.status === 'draft'
            ? { status: 'sent', sentAt: new Date() }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'org.quote.share',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'quote',
          entityId: id,
          after: { number: quoteNumber(q.number) },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.quotes.get(organizationId, id);
  }

  async unshare(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.prisma.quote.updateMany({
      where: { organizationId, id, shareToken: { not: null } },
      data: { shareToken: null },
    });
    if (r.count)
      await this.audit.record({
        action: 'org.quote.unshare',
        actorId: ctx.actor.userId,
        organizationId,
        entityType: 'quote',
        entityId: id,
        req: ctx.req,
      });
    return this.quotes.get(organizationId, id);
  }

  private async find(token: string) {
    const bad = () =>
      new NotFoundException({
        message: 'This link isn’t valid. Ask the business for a new one.',
        details: { reason: 'not_found' },
      });
    if (!SHARE_TOKEN.test(token)) throw bad();
    const q = await this.prisma.quote.findUnique({
      where: { shareToken: token },
      select: {
        id: true,
        organizationId: true,
        contact: { select: { legalName: true, name: true } },
        organization: {
          select: {
            name: true,
            legalName: true,
            taxId: true,
            status: true,
            timeZone: true,
            baseCurrency: true,
            invoiceTerms: true,
          },
        },
      },
    });
    if (!q || q.organization.status !== 'ACTIVE') throw bad();
    return q;
  }

  /** What the customer sees */
  async view(token: string, count = true) {
    const f = await this.find(token);
    if (count)
      await this.prisma.quote.update({
        where: { id: f.id },
        data: { shareViews: { increment: 1 }, shareViewedAt: new Date() },
      });
    const q = await this.quotes.get(f.organizationId, f.id);
    const today = todayIn(f.organization.timeZone);
    return {
      organization: {
        name: f.organization.legalName ?? f.organization.name,
        taxId: f.organization.taxId,
        terms: f.organization.invoiceTerms,
      },
      customer: { name: f.contact.legalName ?? f.contact.name },
      number: q.number,
      quoteDate: q.quoteDate,
      expiryDate: q.expiryDate,
      reference: q.reference,
      notes: q.notes,
      currency: q.currency ?? f.organization.baseCurrency,
      lines: q.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        amount: l.amount,
        taxAmount: l.taxAmount,
      })),
      subtotal: q.subtotal,
      taxTotal: q.taxTotal,
      total: q.total,
      status: q.status,
      state: quoteState(
        { status: q.status as QuoteStatus, expiryDate: q.expiryDate },
        today,
      ),
      decidedBy: q.decidedBy,
      decidedAt: q.decidedAt,
      decisionNote: q.decisionNote,
    };
  }

  async pdf(token: string) {
    const f = await this.find(token);
    return this.quotes.download(f.organizationId, f.id);
  }

  /** The customer accepts or declines from the link, while the quote is sent and not past its date */
  async decide(
    token: string,
    input: {
      response: 'accept' | 'decline';
      name: string;
      note?: string | null;
    },
  ) {
    const f = await this.find(token);
    const today = todayIn(f.organization.timeZone);
    const status = input.response === 'accept' ? 'accepted' : 'declined';
    const q = await this.prisma.quote.findUniqueOrThrow({
      where: { id: f.id },
      select: { status: true, expiryDate: true, number: true },
    });
    if (q.status !== 'sent')
      throw new ConflictException({
        message: 'This quote has been answered already.',
        details: { reason: 'answered', status: q.status },
      });
    if (iso(q.expiryDate) < today)
      throw new ConflictException({
        message: 'This quote has expired. Ask the business for a new one.',
        details: { reason: 'expired' },
      });
    const done = await this.prisma.quote.updateMany({
      where: { id: f.id, status: 'sent' },
      data: {
        status,
        decidedAt: new Date(),
        decidedBy: input.name,
        decisionNote: input.note ?? null,
      },
    });
    if (!done.count)
      throw new ConflictException({
        message: 'This quote has been answered already.',
        details: { reason: 'answered' },
      });
    await this.audit.record({
      action: `org.quote.${input.response === 'accept' ? 'accept' : 'decline'}`,
      organizationId: f.organizationId,
      entityType: 'quote',
      entityId: f.id,
      before: { status: 'sent' },
      after: { status, by: input.name, from: 'customer_link' },
    });
    void this.webhooks.emit(
      f.organizationId,
      `quote.${status}`,
      await this.quotes.get(f.organizationId, f.id),
    );
    return this.view(token, false);
  }
}
