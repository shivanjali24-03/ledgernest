import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  fiscalYearOf,
  fiscalYearSpan,
  invoiceNumber,
  invoiceState,
  msmeCovered,
  msmeLateInterest,
  todayIn,
  upiPayUri,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
import { InvoicesService } from './invoices.service.js';
import { StatementsService } from '../reports/statements.service.js';
import { SHARE_TOKEN } from './invoice-share.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/**
 * A customer's own link: everything they still owe, invoice by invoice, each with its PDF, and one UPI QR code for
 * the rupee total. Sent on WhatsApp so a customer with several invoices pays them all at once. Revocable, counted.
 */
@Injectable()
export class CustomerLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly documents: InvoiceRemindersService,
    private readonly statements: StatementsService,
  ) {}

  private async customer(organizationId: string, id: string) {
    const c = await this.prisma.contact.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        name: true,
        isCustomer: true,
        shareToken: true,
        shareViews: true,
        shareViewedAt: true,
      },
    });
    if (!c) throw new NotFoundException('Contact not found.');
    if (!c.isCustomer)
      throw new BadRequestException({
        message: 'Only customers have an account link.',
        details: { reason: 'not_customer' },
      });
    return c;
  }

  async share(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const c = await this.customer(organizationId, id);
    if (c.shareToken)
      return {
        token: c.shareToken,
        views: c.shareViews,
        lastViewedAt: c.shareViewedAt,
      };
    const token = randomBytes(24).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: { shareToken: token, shareViews: 0, shareViewedAt: null },
      });
      await this.audit.record(
        {
          action: 'org.contact.share',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'contact',
          entityId: id,
          after: { name: c.name },
          req: ctx.req,
        },
        tx,
      );
    });
    return { token, views: 0, lastViewedAt: null };
  }

  async unshare(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const c = await this.customer(organizationId, id);
    if (!c.shareToken) return { ok: true };
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({ where: { id }, data: { shareToken: null } });
      await this.audit.record(
        {
          action: 'org.contact.unshare',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'contact',
          entityId: id,
          before: { name: c.name, views: c.shareViews },
          req: ctx.req,
        },
        tx,
      );
    });
    return { ok: true };
  }

  /** Records that the customer was chased for what's overdue (by WhatsApp or phone; email reminders record themselves) */
  async chased(id: string, channel: 'whatsapp' | 'phone', ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const c = await this.customer(organizationId, id);
    const now = new Date();
    await this.prisma.contact.update({
      where: { id },
      data: { lastChasedAt: now },
    });
    await this.audit.record({
      action: 'org.contact.chased',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'contact',
      entityId: id,
      after: { name: c.name, channel },
      req: ctx.req,
    });
    return { lastChasedAt: now };
  }

  /** The link's customer, or not found for anything that isn't a live link */
  private async find(token: string) {
    const bad = () =>
      new NotFoundException({
        message: 'This link isn’t valid. Ask the business for a new one.',
        details: { reason: 'not_found' },
      });
    if (!SHARE_TOKEN.test(token)) throw bad();
    const c = await this.prisma.contact.findUnique({
      where: { shareToken: token },
      select: {
        id: true,
        name: true,
        legalName: true,
        organizationId: true,
        organization: { select: { status: true } },
      },
    });
    if (!c || c.organization.status !== 'ACTIVE') throw bad();
    return c;
  }

  /** What the customer sees: who it's from, each invoice still owed, the totals, and how to pay the rupee total */
  async view(token: string, now = new Date()) {
    const c = await this.find(token);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: c.organizationId },
      select: {
        name: true,
        legalName: true,
        taxId: true,
        email: true,
        phone: true,
        baseCurrency: true,
        timeZone: true,
        upiId: true,
        msmeCategory: true,
        udyamNumber: true,
        msmeBankRateBp: true,
      },
    });
    const rows = await this.prisma.invoice.findMany({
      where: {
        organizationId: c.organizationId,
        contactId: c.id,
        status: 'issued',
        amountPaid: { lt: this.prisma.invoice.fields.total },
      },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        total: true,
        amountPaid: true,
        fiscalYear: { select: { name: true } },
        fullNumber: true,
      },
    });
    await this.prisma.contact.update({
      where: { id: c.id },
      data: { shareViews: { increment: 1 }, shareViewedAt: now },
    });
    const today = todayIn(org.timeZone, now);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    // A micro or small supplier may charge interest for paying late (MSMED Act s.16)
    const charges =
      msmeCovered(org.msmeCategory as 'micro' | 'small' | null) &&
      !!org.msmeBankRateBp;
    const invoices = rows.map((i) => ({
      id: i.id,
      number: i.fullNumber ?? invoiceNumber(i.fiscalYear!.name, i.number!),
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      currency: i.currency ?? org.baseCurrency,
      total: Number(i.total),
      balance: Number(i.total - i.amountPaid),
      state: invoiceState(
        {
          status: 'issued',
          total: Number(i.total),
          amountPaid: Number(i.amountPaid),
          dueDate: iso(i.dueDate),
        },
        today,
      ),
      msmeInterest:
        charges && (i.currency ?? org.baseCurrency) === 'INR'
          ? msmeLateInterest(
              Number(i.total - i.amountPaid),
              iso(i.issueDate),
              iso(i.dueDate),
              today,
              org.msmeBankRateBp!,
            )
          : 0,
    }));
    const totals = [...new Set(invoices.map((i) => i.currency))].map(
      (currency) => ({
        currency,
        balance: invoices
          .filter((i) => i.currency === currency)
          .reduce((s, i) => s + i.balance, 0),
      }),
    );
    const rupees = invoices.filter((i) => i.currency === 'INR');
    const inr = rupees.reduce((s, i) => s + i.balance, 0);
    const upi =
      org.upiId && inr > 0
        ? {
            upiId: org.upiId,
            amount: inr,
            // One invoice: its number, so the payment matches itself in the bank (#209); several: the list
            link: upiPayUri({
              upiId: org.upiId,
              name: org.legalName ?? org.name,
              amount: inr,
              note:
                rupees.length === 1
                  ? `Invoice ${rupees[0]!.number}`
                  : `Invoices ${rupees.map((i) => i.number).join(', ')}`,
              reference: rupees.length === 1 ? rupees[0]!.number : null,
            }),
          }
        : null;
    return {
      organization: {
        name: org.legalName ?? org.name,
        taxId: org.taxId,
        email: org.email,
        phone: org.phone,
      },
      customer: { name: c.legalName ?? c.name },
      invoices,
      totals,
      overdue: invoices
        .filter((i) => i.state === 'overdue' && i.currency === 'INR')
        .reduce((s, i) => s + i.balance, 0),
      upi,
      msme: charges
        ? {
            udyamNumber: org.udyamNumber,
            interest: invoices.reduce((s, i) => s + i.msmeInterest, 0),
          }
        : null,
    };
  }

  /** The customer's statement of account from the start of this financial year to today, from their link */
  async statementPdf(token: string) {
    const c = await this.find(token);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: c.organizationId },
      select: { timeZone: true, fiscalYearStartMonth: true },
    });
    const today = todayIn(org.timeZone);
    const from = fiscalYearSpan(
      fiscalYearOf(today, org.fiscalYearStartMonth),
      org.fiscalYearStartMonth,
    ).periods[0]!.startDate;
    const s = await this.statements.statement(
      c.organizationId,
      c.id,
      'receivables',
      from,
      today,
    );
    return this.statements.file(c.organizationId, s, 'pdf');
  }

  /** One of the customer's issued invoices as a PDF, from their link */
  async pdf(token: string, invoiceId: string) {
    const c = await this.find(token);
    const inv = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId: c.organizationId,
        contactId: c.id,
        status: 'issued',
      },
      select: { id: true },
    });
    if (!inv)
      throw new NotFoundException({
        message: 'That invoice isn’t on this link.',
        details: { reason: 'not_found' },
      });
    const full = await this.invoices.get(c.organizationId, inv.id);
    const { pdf, fileName } = await this.documents.invoicePdf(
      c.organizationId,
      full,
    );
    return { data: pdf, fileName };
  }
}
