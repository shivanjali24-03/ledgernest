import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { currencyDigits, pdfTableBytes } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from './payments.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/** A receipt for money a customer paid: a PDF of what came in and which invoices it settled, by email */
@Injectable()
export class PaymentReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  async email(
    id: string,
    input: { email?: string; message?: string },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const p = await this.payments.get(organizationId, id);
    if (p.kind !== 'receipt' || p.status !== 'posted')
      throw new ConflictException({
        message: 'Only posted receipts from customers can be sent.',
        details: { reason: 'not_receipt' },
      });
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server. Print the receipt and send it yourself.',
        details: { reason: 'mail_off' },
      });
    const [contact, org] = await Promise.all([
      this.prisma.contact.findFirstOrThrow({
        where: { id: p.contact.id, organizationId },
        select: { email: true, legalName: true, name: true },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          baseCurrency: true,
        },
      }),
    ]);
    const to = input.email ?? contact.email;
    if (!to)
      throw new BadRequestException({
        message: 'This customer has no email address. Enter one to send it to.',
        details: { reason: 'no_email' },
      });
    const currency = p.currency ?? org.baseCurrency;
    const digits = currencyDigits(currency);
    const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
    const seller = org.legalName ?? org.name;
    const rows = [
      ['Applied to', `Amount (${currency})`],
      ...p.allocations.map((a) => [
        a.documentNumber ?? 'Invoice',
        fmt(a.amount),
      ]),
      ...(p.unallocated ? [['Held as advance', fmt(p.unallocated)]] : []),
      ['Total received', fmt(p.amount)],
    ];
    const pdf = Buffer.from(
      pdfTableBytes({
        title: `Payment receipt ${p.number}`,
        subtitle: `${seller}${org.taxId ? ` · GSTIN ${org.taxId}` : ''}`,
        info: [
          `Received from: ${contact.legalName ?? contact.name}`,
          `Date ${p.date} · ${currency} ${fmt(p.amount)}${p.reference ? ` · Ref ${p.reference}` : ''}`,
        ],
        footer: `${seller} · ${p.number}`,
        rows,
      }),
    );
    const sent = await this.mail.send({
      to: [to],
      subject: `Payment receipt ${p.number} from ${org.name}`,
      text: [
        `Dear ${contact.name},`,
        ...(input.message ? [input.message] : []),
        `Thank you for your payment of ${currency} ${fmt(p.amount)} on ${p.date}. The receipt is attached.`,
        org.name,
      ].join('\n\n'),
      attachments: [
        {
          filename: `receipt-${p.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
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
      action: 'org.payment.email',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'payment',
      entityId: id,
      after: { number: p.number, email: to, amount: p.amount },
      req: ctx.req,
    });
    return { sentTo: to };
  }
}
