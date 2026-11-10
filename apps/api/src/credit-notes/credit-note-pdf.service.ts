import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  currencyDigits,
  findIndianState,
  pdfTableBytes,
  rupeesInWords,
} from '@ledgernest/shared';
import { organizationLogo } from '../common/pdf-logo.js';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { organizationSender } from '../common/reply-to.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreditNotesService } from './credit-notes.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A credit note as the customer receives it: who issued it and to whom (with GSTINs), the invoice it's against and
 * that invoice's date (as GST asks), each line with its HSN/SAC, taxable value and tax, the total in words, and for a
 * GST-registered business the signature block.
 */
@Injectable()
export class CreditNotePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notes: CreditNotesService,
  ) {}

  async download(organizationId: string, id: string) {
    const cn = await this.notes.get(organizationId, id);
    const [org, contact, invoice, invoiceLines, logo] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
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
        },
      }),
      this.prisma.contact.findFirstOrThrow({
        where: { organizationId, id: cn.contact.id },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          billingAddress: true,
        },
      }),
      this.prisma.invoice.findFirstOrThrow({
        where: { organizationId, id: cn.invoice.id },
        select: { issueDate: true, placeOfSupply: true },
      }),
      this.prisma.invoiceLine.findMany({
        where: {
          organizationId,
          id: {
            in: cn.lines.flatMap((l) =>
              l.invoiceLineId ? [l.invoiceLineId] : [],
            ),
          },
        },
        select: { id: true, item: { select: { hsnSac: true } } },
      }),
      organizationLogo(this.prisma, organizationId),
    ]);
    const hsn = new Map(invoiceLines.map((l) => [l.id, l.item?.hsnSac ?? '']));
    const currency = cn.currency ?? org.baseCurrency;
    const digits = currencyDigits(currency);
    const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
    const total = (label: string, minor: number) => [
      '',
      '',
      '',
      label,
      '',
      fmt(minor),
    ];
    const address = (a: Record<string, string | null | undefined>) =>
      [a.line1, a.line2, a.city, a.region, a.postalCode]
        .filter(Boolean)
        .join(', ');
    const seller = org.legalName ?? org.name;
    const pos = invoice.placeOfSupply
      ? findIndianState(invoice.placeOfSupply)
      : undefined;
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        title: `Credit note ${cn.number}${cn.status === 'void' ? ' (void)' : ''}`,
        subtitle: `${seller}${org.taxId ? ` · GSTIN ${org.taxId}` : ''}`,
        info: [
          address({
            line1: org.addressLine1,
            line2: org.addressLine2,
            city: org.city,
            region: org.region,
            postalCode: org.postalCode,
          }),
          `To: ${contact.legalName ?? contact.name}${contact.taxId ? ` · ${contact.taxId}` : ''}`,
          address(
            (contact.billingAddress ?? {}) as Record<string, string | null>,
          ),
          `Date ${cn.date} · Against invoice ${cn.invoice.number ?? ''} dated ${iso(invoice.issueDate)}${pos ? ` · Place of supply: ${pos.name} (${pos.code})` : ''}`,
          ...(cn.reason ? [`Reason: ${cn.reason}`] : []),
        ].filter(Boolean),
        rows: [
          [
            'Description',
            'HSN/SAC',
            'Qty',
            `Price (${currency})`,
            'Taxable value',
            'Tax',
          ],
          ...cn.lines.map((l) => [
            l.description,
            (l.invoiceLineId && hsn.get(l.invoiceLineId)) || '',
            l.quantity,
            fmt(l.unitPrice),
            fmt(l.amount),
            fmt(l.taxAmount),
          ]),
          total('Subtotal', cn.subtotal),
          ...cn.taxBreakdown.map((t) => total(t.name, t.amount)),
          total(`Total (${currency})`, cn.total),
        ],
        after: [
          ...(currency === 'INR'
            ? [`Amount in words: ${rupeesInWords(cn.total)}`]
            : []),
          ...(org.taxId
            ? ['', `For ${seller}`, '', '', 'Authorised signatory']
            : []),
        ],
        footer: `${seller} · ${cn.number}`,
      }),
    );
    return {
      data: pdf,
      fileName: `credit-note-${cn.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }

  /** Emails the credit note as a PDF to the customer (or the address given), and records that it went */
  async email(
    id: string,
    input: { email?: string; message?: string },
    ctx: { actor: Actor; tenant: Tenant; req: Request },
  ) {
    const organizationId = ctx.tenant.organizationId;
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server. Download the PDF and send it yourself.',
        details: { reason: 'mail_off' },
      });
    const note = await this.notes.get(organizationId, id);
    const contact = await this.prisma.contact.findFirstOrThrow({
      where: { organizationId, id: note.contact.id },
      select: { name: true, email: true },
    });
    const to = input.email ?? contact.email;
    if (!to)
      throw new BadRequestException({
        message: 'This customer has no email address. Enter one to send it to.',
        details: { reason: 'no_email' },
      });
    const file = await this.download(organizationId, id);
    const { name } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const sent = await this.mail.send({
      ...(await organizationSender(this.prisma, organizationId)),
      to: [to],
      subject: `Credit note ${note.number} from ${name}`,
      text: [
        `Dear ${contact.name},`,
        ...(input.message ? [input.message] : []),
        `Please find attached credit note ${note.number} against invoice ${note.invoice.number ?? ''}.`,
        name,
      ].join('\n\n'),
      attachments: [
        {
          filename: file.fileName,
          content: file.data,
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
      action: 'org.credit_note.email',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'credit_note',
      entityId: id,
      after: { number: note.number, email: to },
      req: ctx.req,
    });
    return { sentTo: to };
  }
}
