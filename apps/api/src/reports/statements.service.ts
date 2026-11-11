import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  billNumber,
  buildStatement,
  creditNoteNumber,
  vendorCreditNumber,
  csvCell,
  currencyDigits,
  pdfTableBytes,
  PDF_TYPE,
  statementTitle,
  type statementEmailSchema,
  invoiceNumber,
  paymentNumber,
  statementRows,
  type AccountStatement,
  type AccountStatementEvent,
  type AgingSide,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { organizationReplyTo } from '../common/reply-to.js';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Statements of account: what changed a contact's balance with us, line by line */
@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async statement(
    organizationId: string,
    contactId: string,
    side: AgingSide,
    from: string,
    to: string,
  ): Promise<AccountStatement & { baseCurrency: string }> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: { id: true, name: true, email: true },
    });
    if (!contact) throw new NotFoundException('That contact doesn’t exist.');
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const until = new Date(`${to}T00:00:00Z`);
    const where = { organizationId, contactId };
    const events: AccountStatementEvent[] = [];
    const add = (
      d: {
        id: string;
        currency: string | null;
        voidEntry: { date: Date } | null;
      },
      kind: Exclude<AccountStatementEvent['kind'], 'void'>,
      date: Date,
      number: string,
      reference: string | null,
      amount: number,
    ) => {
      const currency = d.currency ?? baseCurrency;
      const base = { documentId: d.id, number, reference, currency };
      events.push({ ...base, kind, date: iso(date), amount });
      if (d.voidEntry)
        events.push({
          ...base,
          kind: 'void',
          voided: kind,
          date: iso(d.voidEntry.date),
          amount: -amount,
        });
    };
    const common = {
      id: true,
      currency: true,
      total: true,
      fiscalYear: { select: { name: true } },
      voidEntry: { select: { date: true } },
    } as const;

    if (side === 'receivables') {
      const [invoices, credits] = await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            ...where,
            status: { in: ['issued', 'void'] },
            number: { not: null },
            issueDate: { lte: until },
          },
          select: {
            ...common,
            number: true,
            issueDate: true,
            reference: true,
          },
        }),
        this.prisma.creditNote.findMany({
          where: { ...where, date: { lte: until } },
          select: {
            ...common,
            number: true,
            date: true,
            reason: true,
          },
        }),
      ]);
      for (const i of invoices)
        add(
          i,
          'invoice',
          i.issueDate,
          invoiceNumber(i.fiscalYear!.name, i.number!),
          i.reference,
          Number(i.total),
        );
      for (const c of credits)
        add(
          c,
          'credit_note',
          c.date,
          creditNoteNumber(c.fiscalYear.name, c.number),
          c.reason,
          -Number(c.total),
        );
    } else {
      const bills = await this.prisma.bill.findMany({
        where: {
          ...where,
          status: { in: ['open', 'void'] },
          number: { not: null },
          billDate: { lte: until },
        },
        select: {
          ...common,
          number: true,
          billDate: true,
          vendorReference: true,
        },
      });
      for (const b of bills)
        add(
          b,
          'bill',
          b.billDate,
          billNumber(b.fiscalYear!.name, b.number!),
          b.vendorReference,
          Number(b.total),
        );
      // Debit notes bring what's owed down; a vendor refunding one brings it back up
      const debitNotes = await this.prisma.vendorCredit.findMany({
        where: { ...where, date: { lte: until } },
        select: {
          id: true,
          total: true,
          number: true,
          date: true,
          vendorReference: true,
          reason: true,
          fiscalYear: { select: { name: true } },
          voidEntry: { select: { date: true } },
          applications: {
            where: { journalEntryId: { not: null }, date: { lte: until } },
            select: { id: true, date: true, amount: true, reference: true },
          },
        },
      });
      for (const n of debitNotes) {
        const label = vendorCreditNumber(n.fiscalYear.name, n.number);
        add(
          { ...n, currency: null },
          'debit_note',
          n.date,
          label,
          n.vendorReference ?? n.reason,
          -Number(n.total),
        );
        for (const r of n.applications)
          add(
            { id: r.id, currency: null, voidEntry: null },
            'refund',
            r.date,
            label,
            r.reference,
            Number(r.amount),
          );
      }
    }
    const kind = side === 'receivables' ? 'receipt' : 'payment';
    const payments = await this.prisma.payment.findMany({
      where: { ...where, kind, date: { lte: until } },
      select: {
        id: true,
        currency: true,
        amount: true,
        number: true,
        date: true,
        reference: true,
        fiscalYear: { select: { name: true } },
        voidEntry: { select: { date: true } },
      },
    });
    for (const p of payments)
      add(
        p,
        kind,
        p.date,
        paymentNumber(kind, p.fiscalYear.name, p.number),
        p.reference,
        -Number(p.amount),
      );

    return {
      contact,
      side,
      from,
      to,
      baseCurrency,
      sections: buildStatement(events, from, to, baseCurrency),
    };
  }

  /** The statement as a PDF file, named for the contact and dates */
  async file(
    organizationId: string,
    s: AccountStatement,
    format: 'csv' | 'pdf',
  ) {
    const slug =
      s.contact.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'contact';
    const fileName = `statement-${slug}-${s.from}-${s.to}.${format}`;
    if (format === 'csv')
      return {
        fileName,
        contentType: 'text/csv; charset=utf-8',
        data: Buffer.from(this.csv(s), 'utf8'),
      };
    const { name } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    return {
      fileName,
      contentType: PDF_TYPE,
      data: Buffer.from(
        pdfTableBytes({
          title: `${statementTitle(s.side)}: ${s.contact.name}`,
          subtitle: `${name} · ${s.from} to ${s.to}`,
          footer: `${name} · LedgerNest`,
          rows: statementRows(s),
        }),
      ),
    };
  }

  /** Emails the statement as a PDF to the contact (or the address given), and records that it went */
  async email(
    input: z.output<typeof statementEmailSchema>,
    ctx: { actor: Actor; tenant: Tenant; req: Request },
  ) {
    const organizationId = ctx.tenant.organizationId;
    if (!this.mail.configured)
      throw new ConflictException({
        message:
          'Email isn’t set up on this server. Download the PDF and send it yourself.',
        details: { reason: 'mail_off' },
      });
    const s = await this.statement(
      organizationId,
      input.contactId,
      input.side,
      input.from,
      input.to,
    );
    const to = input.email ?? s.contact.email;
    if (!to)
      throw new BadRequestException({
        message: 'This contact has no email address. Enter one to send it to.',
        details: { reason: 'no_email' },
      });
    const { name } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const file = await this.file(organizationId, s, 'pdf');
    const money = (minor: number, currency: string) =>
      `${currency} ${(minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency))}`;
    const balances = s.sections.length
      ? s.sections
          .map(
            (sec) => `Balance on ${s.to}: ${money(sec.closing, sec.currency)}`,
          )
          .join('\n')
      : 'Nothing moved in these dates.';
    const sent = await this.mail.send({
      replyTo: await organizationReplyTo(this.prisma, organizationId),
      to: [to],
      subject: `${statementTitle(s.side)} from ${name}, ${s.from} to ${s.to}`,
      text: `Dear ${s.contact.name},\n\n${input.message ? `${input.message}\n\n` : ''}Your ${statementTitle(s.side).toLowerCase()} with ${name} for ${s.from} to ${s.to} is attached.\n\n${balances}\n\n${name}`,
      attachments: [
        {
          filename: file.fileName,
          content: file.data,
          contentType: file.contentType,
        },
      ],
    });
    if (!sent)
      throw new ConflictException({
        message: 'The email couldn’t be sent. Try again later.',
        details: { reason: 'mail_failed' },
      });
    await this.audit.record({
      action: 'org.statement.email',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'contact',
      entityId: s.contact.id,
      after: {
        contact: s.contact.name,
        side: s.side,
        from: s.from,
        to: s.to,
        email: to,
      },
      req: ctx.req,
    });
    return { sentTo: to };
  }

  csv(s: AccountStatement) {
    return `﻿${statementRows(s)
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n')}\r\n`;
  }
}
