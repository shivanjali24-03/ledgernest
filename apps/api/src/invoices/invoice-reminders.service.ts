import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  currencyDigits,
  daysBetween,
  type invoiceReminderSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/** Payment reminders: an email to the customer about an issued invoice that still has something owed */
@Injectable()
export class InvoiceRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async remind(
    id: string,
    input: z.output<typeof invoiceReminderSchema>,
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
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
      select: { name: true, baseCurrency: true, timeZone: true },
    });
    const currency = inv.currency ?? org.baseCurrency;
    const digits = currencyDigits(currency);
    const money = (minor: number) =>
      `${currency} ${(minor / 10 ** digits).toFixed(digits)}`;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: org.timeZone,
    }).format(new Date());
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
      data: { lastRemindedAt: new Date(), reminders: { increment: 1 } },
      select: { lastRemindedAt: true, reminders: true },
    });
    await this.audit.record({
      action: 'org.invoice.remind',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'invoice',
      entityId: id,
      after: {
        number: inv.number,
        email: to,
        balance: inv.balance,
        reminders: updated.reminders,
      },
      req: ctx.req,
    });
    return { sentTo: to, ...updated };
  }
}
