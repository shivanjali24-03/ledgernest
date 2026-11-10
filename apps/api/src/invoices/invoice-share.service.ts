import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { invoiceState, todayIn } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
import { InvoicesService } from './invoices.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/** 24 random bytes, base64url: 32 characters nobody can guess */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * Invoice links for customers: a random address that opens the invoice without signing in (to send by WhatsApp,
 * SMS or anywhere), with its PDF and the pay-by-UPI QR code. Made on demand, revocable, and counted when opened.
 */
@Injectable()
export class InvoiceShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly documents: InvoiceRemindersService,
  ) {}

  /** The invoice's link, made the first time; the same link after that */
  async share(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const inv = await this.invoices.get(organizationId, id);
    if (inv.status !== 'issued')
      throw new ConflictException({
        message: 'Only issued invoices can be shared.',
        details: { reason: 'not_issued' },
      });
    if (inv.share) return inv.share;
    const token = randomBytes(24).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: { shareToken: token, shareViews: 0, shareViewedAt: null },
      });
      await this.audit.record(
        {
          action: 'org.invoice.share',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
          entityId: id,
          after: { number: inv.number },
          req: ctx.req,
        },
        tx,
      );
    });
    return { token, views: 0, lastViewedAt: null };
  }

  /** Stops the link working; sharing again makes a new one */
  async unshare(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const inv = await this.invoices.get(organizationId, id);
    if (!inv.share) return { ok: true };
    const { views } = inv.share;
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: { shareToken: null },
      });
      await this.audit.record(
        {
          action: 'org.invoice.unshare',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
          entityId: id,
          before: { number: inv.number, views },
          req: ctx.req,
        },
        tx,
      );
    });
    return { ok: true };
  }

  private async find(token: string) {
    if (!SHARE_TOKEN.test(token))
      throw new NotFoundException({
        message: 'This invoice link isn’t valid.',
        details: { reason: 'not_found' },
      });
    const row = await this.prisma.invoice.findUnique({
      where: { shareToken: token },
      select: {
        id: true,
        organizationId: true,
        organization: { select: { status: true } },
      },
    });
    if (!row || row.organization.status !== 'ACTIVE')
      throw new NotFoundException({
        message:
          'This invoice link isn’t valid. Ask the business for a new one.',
        details: { reason: 'not_found' },
      });
    const inv = await this.invoices.get(row.organizationId, row.id);
    if (inv.status === 'void')
      throw new GoneException({
        message: 'This invoice was cancelled.',
        details: { reason: 'void' },
      });
    return { organizationId: row.organizationId, inv };
  }

  /**
   * What the customer sees: who it's from, the lines, tax and totals, what's paid and owed, and how to pay. Nothing
   * internal (accounts, journals, ids, notes for the team) leaves.
   */
  async view(token: string, now = new Date()) {
    const { organizationId, inv } = await this.find(token);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        taxId: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        region: true,
        postalCode: true,
        baseCurrency: true,
        invoiceTerms: true,
        upiId: true,
        timeZone: true,
        logo: { select: { updatedAt: true } },
      },
    });
    await this.prisma.invoice.update({
      where: { id: inv.id },
      data: { shareViews: { increment: 1 }, shareViewedAt: now },
    });
    const currency = inv.currency ?? org.baseCurrency;
    const upi = this.documents.upiLink(org, inv, currency);
    const today = todayIn(org.timeZone, now);
    return {
      organization: {
        name: org.legalName ?? org.name,
        taxId: org.taxId,
        email: org.email,
        phone: org.phone,
        address: {
          line1: org.addressLine1,
          line2: org.addressLine2,
          city: org.city,
          region: org.region,
          postalCode: org.postalCode,
        },
        terms: org.invoiceTerms,
        hasLogo: !!org.logo,
      },
      invoice: {
        number: inv.number!,
        state: invoiceState(
          {
            status: inv.status,
            total: inv.total,
            amountPaid: inv.amountPaid,
            dueDate: inv.dueDate,
          },
          today,
        ),
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        currency,
        placeOfSupply: inv.placeOfSupply,
        reference: inv.reference,
        customer: {
          name: inv.contact.legalName ?? inv.contact.name,
          taxId: inv.contact.taxId,
        },
        lines: inv.lines.map((l) => ({
          description: l.description,
          hsnSac: l.item?.hsnSac ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          amount: l.amount,
          taxAmount: l.taxAmount,
        })),
        subtotal: inv.subtotal,
        taxBreakdown: inv.taxBreakdown,
        total: inv.total,
        amountPaid: inv.amountPaid,
        balance: inv.balance,
      },
      upi: upi && { link: upi, upiId: org.upiId },
    };
  }

  async pdf(token: string) {
    const { organizationId, inv } = await this.find(token);
    const { pdf, fileName } = await this.documents.invoicePdf(
      organizationId,
      inv,
    );
    return { data: pdf, fileName };
  }

  async logo(token: string) {
    const { organizationId } = await this.find(token);
    const logo = await this.prisma.organizationLogo.findUnique({
      where: { organizationId },
      select: { contentType: true, data: true },
    });
    if (!logo)
      throw new NotFoundException({
        message: 'No logo.',
        details: { reason: 'not_found' },
      });
    return logo;
  }
}
