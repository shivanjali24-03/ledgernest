import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  chequePdfBytes,
  currencyDigits,
  pdfTableBytes,
  type ChequeOptions,
} from '@ledgernest/shared';
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

  private pdf(
    p: Awaited<ReturnType<PaymentsService['get']>>,
    contact: { legalName: string | null; name: string },
    org: {
      name: string;
      legalName: string | null;
      taxId: string | null;
      baseCurrency: string;
    },
  ) {
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
      ...(p.tds
        ? [
            [
              `Of which TDS deducted by you (${p.tds.section})`,
              fmt(p.tds.amount),
            ],
            ['Into our bank', fmt(p.bankAmount)],
          ]
        : []),
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
    return { pdf, currency, fmt };
  }

  /** The PDF of a posted receipt, to download */
  async download(organizationId: string, id: string) {
    const p = await this.payments.get(organizationId, id);
    if (p.kind !== 'receipt')
      throw new ConflictException({
        message: 'Only receipts from customers have a receipt to download.',
        details: { reason: 'not_receipt' },
      });
    const [contact, org] = await Promise.all([
      this.prisma.contact.findFirstOrThrow({
        where: { id: p.contact.id, organizationId },
        select: { legalName: true, name: true },
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
    const { pdf } = this.pdf(p, contact, org);
    return {
      data: pdf,
      fileName: `receipt-${p.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }

  /** A vendor payment printed onto a cheque leaf: the payee, date, and what the bank pays (after TDS) */
  async cheque(organizationId: string, id: string, options: ChequeOptions) {
    const p = await this.payments.get(organizationId, id);
    if (p.kind !== 'payment' || p.status !== 'posted')
      throw new ConflictException({
        message: 'Only posted payments to vendors can be printed on a cheque.',
        details: { reason: 'not_payment' },
      });
    if (p.currency)
      throw new ConflictException({
        message: 'Cheques are in rupees: this payment is in another currency.',
        details: { reason: 'not_inr' },
      });
    const contact = await this.prisma.contact.findFirstOrThrow({
      where: { id: p.contact.id, organizationId },
      select: { legalName: true, name: true },
    });
    return {
      data: chequePdfBytes(
        {
          payee: contact.legalName ?? contact.name,
          date: p.date,
          amount: p.bankAmount,
        },
        options,
      ),
      fileName: `cheque-${p.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }

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
    const { pdf, currency, fmt } = this.pdf(p, contact, org);
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
