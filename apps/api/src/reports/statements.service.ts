import { Injectable, NotFoundException } from '@nestjs/common';
import {
  billNumber,
  buildStatement,
  creditNoteNumber,
  csvCell,
  invoiceNumber,
  paymentNumber,
  statementRows,
  type AccountStatement,
  type AccountStatementEvent,
  type AgingSide,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Statements of account: what changed a contact's balance with us, line by line */
@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

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

  csv(s: AccountStatement) {
    return `﻿${statementRows(s)
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n')}\r\n`;
  }
}
