import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  currencyDigits,
  pdfTableBytes,
  rupeesInWords,
} from '@ledgernest/shared';
import { organizationLogo, organizationSignature } from '../common/pdf-logo.js';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { organizationSender } from '../common/reply-to.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VendorCreditsService } from './vendor-credits.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A debit note as the vendor receives it, for goods sent back or a price put right: from us to them (with GSTINs),
 * against which of their bills (by their number) and its date, each line with its HSN/SAC, taxable value and tax.
 */
@Injectable()
export class DebitNotePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notes: VendorCreditsService,
  ) {}

  async download(organizationId: string, id: string) {
    const dn = await this.notes.get(organizationId, id);
    const [org, vendor, bill, billLines, logo] = await Promise.all([
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
        where: { organizationId, id: dn.contact.id },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          billingAddress: true,
        },
      }),
      this.prisma.bill.findFirstOrThrow({
        where: { organizationId, id: dn.bill.id },
        select: { billDate: true },
      }),
      this.prisma.billLine.findMany({
        where: {
          organizationId,
          id: {
            in: dn.lines.flatMap((l) => (l.billLineId ? [l.billLineId] : [])),
          },
        },
        select: { id: true, item: { select: { hsnSac: true } } },
      }),
      organizationLogo(this.prisma, organizationId),
    ]);
    const hsn = new Map(billLines.map((l) => [l.id, l.item?.hsnSac ?? '']));
    const currency = org.baseCurrency;
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
    const buyer = org.legalName ?? org.name;
    const theirBill = dn.bill.vendorReference ?? dn.bill.number ?? '';
    const signature = await organizationSignature(this.prisma, organizationId);
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        signature,
        title: `Debit note ${dn.number}${dn.status === 'void' ? ' (void)' : ''}`,
        subtitle: `${buyer}${org.taxId ? ` · GSTIN ${org.taxId}` : ''}`,
        info: [
          address({
            line1: org.addressLine1,
            line2: org.addressLine2,
            city: org.city,
            region: org.region,
            postalCode: org.postalCode,
          }),
          `To: ${vendor.legalName ?? vendor.name}${vendor.taxId ? ` · ${vendor.taxId}` : ''}`,
          address(
            (vendor.billingAddress ?? {}) as Record<string, string | null>,
          ),
          `Date ${dn.date} · Against your bill ${theirBill} dated ${iso(bill.billDate)}${dn.vendorReference ? ` · Your credit note ${dn.vendorReference}` : ''}`,
          ...(dn.reason ? [`Reason: ${dn.reason}`] : []),
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
          ...dn.lines.map((l) => [
            l.description,
            (l.billLineId && hsn.get(l.billLineId)) || '',
            l.quantity,
            fmt(l.unitPrice),
            fmt(l.amount),
            fmt(l.taxAmount),
          ]),
          total('Subtotal', dn.subtotal),
          ...dn.taxBreakdown.map((t) => total(t.name, t.amount)),
          total(`Total (${currency})`, dn.total),
        ],
        after: [
          ...(currency === 'INR'
            ? [`Amount in words: ${rupeesInWords(dn.total)}`]
            : []),
          ...(org.taxId
            ? [
                '',
                `For ${buyer}`,
                '',
                '',
                'Authorised signatory',
                ...(signature.name ? [signature.name] : []),
              ]
            : []),
        ],
        footer: `${buyer} · ${dn.number}`,
      }),
    );
    return {
      data: pdf,
      fileName: `debit-note-${dn.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }

  /** Emails the debit note as a PDF to the vendor (or the address given), and records that it went */
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
        message: 'This vendor has no email address. Enter one to send it to.',
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
      subject: `Debit note ${note.number} from ${name}`,
      text: [
        `Dear ${contact.name},`,
        ...(input.message ? [input.message] : []),
        `Please find attached debit note ${note.number} against your bill ${note.bill.vendorReference ?? note.bill.number ?? ''}.`,
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
      action: 'org.debit_note.email',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'vendor_credit',
      entityId: id,
      after: { number: note.number, email: to },
      req: ctx.req,
    });
    return { sentTo: to };
  }
}
