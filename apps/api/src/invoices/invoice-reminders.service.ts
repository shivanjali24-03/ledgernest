import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  currencyDigits,
  daysBetween,
  DEFAULT_REMINDER_POLICY,
  findIndianState,
  invoiceRows,
  pdfTableBytes,
  qrMatrix,
  rupeesInWords,
  upiPayUri,
  type invoiceEmailSchema,
  reminderDue,
  todayIn,
  type invoiceReminderSchema,
  type ReminderPolicy,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
/** Who sends it: a person from a request, or the automatic run (no actor) */
type Sender = {
  organizationId: string;
  actorId: string | null;
  req?: Request;
};

/**
 * Payment reminders: an email to the customer about an issued invoice that still has something owed, sent by
 * hand or automatically under the organisation's policy. Due automatic ones go out every
 * INVOICE_REMINDERS_MINUTES (60; 0 turns it off).
 */
@Injectable()
export class InvoiceRemindersService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('InvoiceReminders');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(
      process.env.INVOICE_REMINDERS_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 60),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        ),
      minutes * 60_000,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async policy(organizationId: string): Promise<ReminderPolicy> {
    const p = await this.prisma.reminderPolicy.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        firstAfterDays: true,
        repeatEveryDays: true,
        maxReminders: true,
      },
    });
    return p ?? DEFAULT_REMINDER_POLICY;
  }

  async setPolicy(input: ReminderPolicy, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.policy(organizationId);
    await this.prisma.reminderPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
    });
    await this.audit.record({
      action: 'org.invoice.reminder_policy',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'reminder_policy',
      entityId: organizationId,
      before,
      after: input,
      req: ctx.req,
    });
    return input;
  }

  /**
   * Sends every automatic reminder that's due, in organisations whose policy is on and that can send email.
   * Returns how many went. Invoices without a customer email are skipped.
   */
  async runDue(now = new Date()) {
    if (!this.mail.configured) return 0;
    const policies = await this.prisma.reminderPolicy.findMany({
      where: { enabled: true, organization: { status: 'ACTIVE' } },
      select: {
        organizationId: true,
        enabled: true,
        firstAfterDays: true,
        repeatEveryDays: true,
        maxReminders: true,
        organization: { select: { timeZone: true } },
      },
    });
    let sent = 0;
    for (const { organization, organizationId, ...policy } of policies) {
      const today = todayIn(organization.timeZone, now);
      const latestDue = new Date(`${today}T00:00:00Z`);
      latestDue.setUTCDate(
        latestDue.getUTCDate() - Math.max(1, policy.firstAfterDays),
      );
      const candidates = await this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'issued',
          dueDate: { lte: latestDue },
          reminders: { lt: policy.maxReminders },
          total: { gt: this.prisma.invoice.fields.amountPaid },
          contact: { email: { not: null } },
        },
        select: {
          id: true,
          status: true,
          total: true,
          amountPaid: true,
          dueDate: true,
          reminders: true,
          lastRemindedAt: true,
        },
        orderBy: { dueDate: 'asc' },
      });
      for (const c of candidates) {
        const due = reminderDue(
          {
            status: c.status,
            balance: Number(c.total - c.amountPaid),
            dueDate: c.dueDate.toISOString().slice(0, 10),
            reminders: c.reminders,
            lastRemindedAt: c.lastRemindedAt?.toISOString() ?? null,
          },
          policy,
          today,
        );
        if (!due) continue;
        try {
          await this.remind(c.id, {}, { organizationId, actorId: null }, now);
          sent++;
        } catch (e) {
          this.log.warn(
            `Reminder for invoice ${c.id} not sent: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    return sent;
  }

  async remind(
    id: string,
    input: z.output<typeof invoiceReminderSchema>,
    who: Ctx | Sender,
    now = new Date(),
  ) {
    const sender: Sender =
      'tenant' in who
        ? {
            organizationId: who.tenant.organizationId,
            actorId: who.actor.userId,
            req: who.req,
          }
        : who;
    const organizationId = sender.organizationId;
    const inv = await this.invoices.get(organizationId, id);
    if (inv.status !== 'issued' || inv.balance <= 0)
      throw new ConflictException({
        message:
          'Only issued invoices with something still owed get reminders.',
        details: { reason: 'nothing_owed' },
      });
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server, so reminders can’t be sent from here.',
        details: { reason: 'mail_off' },
      });
    const to = input.email ?? inv.contact.email;
    if (!to)
      throw new BadRequestException({
        message: 'This customer has no email address. Enter one to send it to.',
        details: { reason: 'no_email' },
      });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        baseCurrency: true,
        timeZone: true,
        upiId: true,
      },
    });
    const currency = inv.currency ?? org.baseCurrency;
    const upi = this.upiLink(org, inv, currency);
    const digits = currencyDigits(currency);
    const money = (minor: number) =>
      `${currency} ${(minor / 10 ** digits).toFixed(digits)}`;
    const today = todayIn(org.timeZone, now);
    const late = daysBetween(inv.dueDate, today);
    const when =
      late > 0
        ? `was due on ${inv.dueDate} (${late} day${late === 1 ? '' : 's'} ago)`
        : late === 0
          ? 'is due today'
          : `is due on ${inv.dueDate}`;
    const sent = await this.mail.send({
      to: [to],
      subject: `Payment reminder: invoice ${inv.number} from ${org.name}`,
      text: [
        `Dear ${inv.contact.name},`,
        ...(input.message ? [input.message] : []),
        `This is a reminder that invoice ${inv.number}, dated ${inv.issueDate}, ${when}.`,
        `Invoice total: ${money(inv.total)}\nPaid so far: ${money(inv.amountPaid)}\nStill to pay: ${money(inv.balance)}`,
        ...(upi
          ? [
              `Pay by UPI to ${org.upiId}: on your phone, open ${upi} and your UPI app fills in the amount.`,
            ]
          : []),
        'If you’ve already paid, thank you, and please ignore this reminder.',
        org.name,
      ].join('\n\n'),
    });
    if (!sent)
      throw new ConflictException({
        message: 'The email couldn’t be sent. Try again later.',
        details: { reason: 'mail_failed' },
      });
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { lastRemindedAt: now, reminders: { increment: 1 } },
      select: { lastRemindedAt: true, reminders: true },
    });
    await this.audit.record({
      action: 'org.invoice.remind',
      actorId: sender.actorId,
      organizationId,
      entityType: 'invoice',
      entityId: id,
      after: {
        number: inv.number,
        email: to,
        balance: inv.balance,
        reminders: updated.reminders,
        automatic: !sender.actorId,
      },
      req: sender.req,
    });
    return { sentTo: to, ...updated };
  }

  /**
   * The pay-by-UPI link for what's still owed on an invoice: only for issued rupee invoices with a balance, when the
   * organisation has set its UPI ID (UPI moves rupees only)
   */
  upiLink(
    org: { upiId: string | null; name: string; legalName?: string | null },
    inv: { status: string; number: string | null; balance: number },
    currency: string,
  ) {
    if (
      !org.upiId ||
      currency !== 'INR' ||
      inv.status !== 'issued' ||
      inv.balance <= 0 ||
      !inv.number
    )
      return null;
    return upiPayUri({
      upiId: org.upiId,
      name: org.legalName ?? org.name,
      amount: inv.balance,
      note: `Invoice ${inv.number}`,
      reference: inv.number,
    });
  }

  /** An invoice as a PDF: seller and buyer with GSTINs, place of supply, lines, tax by rate, totals and terms */
  async invoicePdf(
    organizationId: string,
    inv: Awaited<ReturnType<InvoicesService['get']>>,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        taxId: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        region: true,
        postalCode: true,
        baseCurrency: true,
        invoiceTerms: true,
        upiId: true,
      },
    });
    const currency = inv.currency ?? org.baseCurrency;
    const digits = currencyDigits(currency);
    const upi = this.upiLink(org, inv, currency);
    const address = (a: Record<string, string | null | undefined>) =>
      [a.line1, a.line2, a.city, a.region, a.postalCode]
        .filter(Boolean)
        .join(', ');
    const seller = org.legalName ?? org.name;
    const pos = inv.placeOfSupply
      ? findIndianState(inv.placeOfSupply)
      : undefined;
    const pdf = Buffer.from(
      pdfTableBytes({
        title: `${org.taxId ? 'Tax invoice' : 'Invoice'} ${inv.number}`,
        subtitle: `${seller}${org.taxId ? ` · GSTIN ${org.taxId}` : ''}`,
        info: [
          address({
            line1: org.addressLine1,
            line2: org.addressLine2,
            city: org.city,
            region: org.region,
            postalCode: org.postalCode,
          }),
          `Bill to: ${inv.contact.legalName ?? inv.contact.name}${inv.contact.taxId ? ` · ${inv.contact.taxId}` : ''}`,
          address(inv.contact.billingAddress),
          `Invoice date ${inv.issueDate} · Due ${inv.dueDate}${inv.reference ? ` · Ref ${inv.reference}` : ''}${pos ? ` · Place of supply: ${pos.name} (${pos.code})` : ''}`,
        ].filter(Boolean),
        after: [
          ...(currency === 'INR'
            ? [`Amount in words: ${rupeesInWords(inv.total)}`, '']
            : []),
          ...(org.invoiceTerms ? org.invoiceTerms.split(/\r?\n/) : []),
        ],
        footer: `${seller} · ${inv.number}`,
        rows: invoiceRows({ ...inv, currency }, digits),
        qr: upi
          ? {
              modules: qrMatrix(upi),
              caption: [
                'Scan to pay with any UPI app',
                `Rs ${(inv.balance / 100).toFixed(2)} to ${org.upiId}`,
              ],
            }
          : undefined,
      }),
    );
    return {
      org,
      upi,
      pdf,
      currency,
      digits,
      fileName: `invoice-${(inv.number ?? 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }

  /** The PDF of an issued (or voided) invoice, to download */
  async download(organizationId: string, id: string) {
    const inv = await this.invoices.get(organizationId, id);
    if (inv.status === 'draft')
      throw new ConflictException({
        message: 'Issue the invoice first: drafts have no number yet.',
        details: { reason: 'not_issued' },
      });
    const { pdf, fileName } = await this.invoicePdf(organizationId, inv);
    return { data: pdf, fileName };
  }

  async emailInvoice(
    id: string,
    input: z.output<typeof invoiceEmailSchema>,
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const inv = await this.invoices.get(organizationId, id);
    if (inv.status !== 'issued')
      throw new ConflictException({
        message: 'Only issued invoices can be emailed.',
        details: { reason: 'not_issued' },
      });
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server. Print the invoice and send it yourself.',
        details: { reason: 'mail_off' },
      });
    const to = input.email ?? inv.contact.email;
    if (!to)
      throw new BadRequestException({
        message: 'This customer has no email address. Enter one to send it to.',
        details: { reason: 'no_email' },
      });
    const { org, upi, pdf, currency, digits, fileName } = await this.invoicePdf(
      organizationId,
      inv,
    );
    const sent = await this.mail.send({
      to: [to],
      subject: `Invoice ${inv.number} from ${org.name}`,
      text: [
        `Dear ${inv.contact.name},`,
        ...(input.message ? [input.message] : []),
        `Please find invoice ${inv.number} attached: ${currency} ${(inv.total / 10 ** digits).toFixed(digits)}, due on ${inv.dueDate}.`,
        ...(inv.amountPaid
          ? [
              `Paid so far: ${currency} ${(inv.amountPaid / 10 ** digits).toFixed(digits)}. Still to pay: ${currency} ${(inv.balance / 10 ** digits).toFixed(digits)}.`,
            ]
          : []),
        ...(upi
          ? [
              `Pay by UPI: scan the QR code on the invoice with any UPI app, or on your phone open ${upi}`,
            ]
          : []),
        org.name,
      ].join('\n\n'),
      attachments: [
        {
          filename: fileName,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
    if (!sent)
      throw new ConflictException({
        message: 'The email couldn’t be sent. Try again later.',
        details: { reason: 'mail_failed' },
      });
    await this.audit.record({
      action: 'org.invoice.email',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'invoice',
      entityId: id,
      after: { number: inv.number, email: to, total: inv.total },
      req: ctx.req,
    });
    return { sentTo: to };
  }

  /**
   * A reminder for each of a customer's overdue invoices, by hand. Returns what went and what didn't (and why),
   * so one bad invoice doesn't stop the rest.
   */
  async remindOverdue(contactId: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: { id: true, email: true },
    });
    if (!contact) throw new NotFoundException('That contact doesn’t exist.');
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server, so reminders can’t be sent from here.',
        details: { reason: 'mail_off' },
      });
    if (!contact.email)
      throw new BadRequestException({
        message:
          'This customer has no email address. Add one to their details first.',
        details: { reason: 'no_email' },
      });
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    const overdue = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        contactId,
        status: 'issued',
        dueDate: { lt: new Date(`${todayIn(timeZone)}T00:00:00Z`) },
        total: { gt: this.prisma.invoice.fields.amountPaid },
      },
      select: { id: true },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });
    const sent: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const i of overdue) {
      try {
        await this.remind(i.id, {}, ctx);
        sent.push(i.id);
      } catch (e) {
        const reason =
          e instanceof ConflictException || e instanceof BadRequestException
            ? (((e.getResponse() as { details?: { reason?: string } }).details
                ?.reason as string | undefined) ?? 'failed')
            : 'failed';
        failed.push({ id: i.id, reason });
      }
    }
    return { sentTo: contact.email, sent: sent.length, failed };
  }
}
