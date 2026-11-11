import { Injectable } from '@nestjs/common';
import {
  buildSalesReport,
  csvCell,
  currencyDigits,
  formatQuantity,
  parseQuantity,
  salesReportRows,
  toBase,
  type SalesReportBy,
  type SalesReportLine,
  type SalesReportSide,
} from '@ledgernest/shared';
import { rateText } from '../currencies/rate-on.js';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** Sales (invoices less credit notes) and purchases (bills) by customer, vendor or item, in the base currency */
@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    organizationId: string,
    side: SalesReportSide,
    by: SalesReportBy,
    from: string,
    to: string,
  ) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const range = { gte: asDate(from), lte: asDate(to) };
    const inBase =
      (currency: string | null, rate: { toFixed(dp: number): string } | null) =>
      (minor: bigint) =>
        currency && rate
          ? toBase(
              Number(minor),
              rateText(rate),
              currencyDigits(currency),
              currencyDigits(baseCurrency),
            )
          : Number(minor);
    const qty = (q: { toFixed(dp: number): string }) =>
      formatQuantity(parseQuantity(q.toFixed(4))!);
    const lineSelect = {
      quantity: true,
      amount: true,
      taxAmount: true,
      item: { select: { id: true, name: true } },
    } as const;
    const lines: SalesReportLine[] = [];

    if (side === 'sales') {
      const [invoices, notes] = await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            organizationId,
            status: 'issued',
            opening: false,
            issueDate: range,
          },
          select: {
            id: true,
            currency: true,
            rate: true,
            contact: { select: { id: true, name: true } },
            lines: { select: lineSelect },
          },
        }),
        this.prisma.creditNote.findMany({
          where: {
            organizationId,
            status: 'issued',
            date: range,
            invoice: { opening: false },
          },
          select: {
            id: true,
            currency: true,
            rate: true,
            contact: { select: { id: true, name: true } },
            lines: {
              select: {
                quantity: true,
                amount: true,
                taxAmount: true,
                invoiceLine: {
                  select: { item: { select: { id: true, name: true } } },
                },
              },
            },
          },
        }),
      ]);
      for (const i of invoices) {
        const base = inBase(i.currency, i.rate);
        for (const l of i.lines)
          lines.push({
            documentId: i.id,
            contact: i.contact,
            item: l.item,
            quantity: qty(l.quantity),
            net: base(l.amount),
            tax: base(l.taxAmount),
            sign: 1,
          });
      }
      for (const n of notes) {
        const base = inBase(n.currency, n.rate);
        for (const l of n.lines)
          lines.push({
            documentId: n.id,
            contact: n.contact,
            item: l.invoiceLine.item,
            quantity: qty(l.quantity),
            net: base(l.amount),
            tax: base(l.taxAmount),
            sign: -1,
          });
      }
    } else {
      const bills = await this.prisma.bill.findMany({
        where: {
          organizationId,
          status: 'open',
          opening: false,
          billDate: range,
        },
        select: {
          id: true,
          currency: true,
          rate: true,
          contact: { select: { id: true, name: true } },
          lines: { select: lineSelect },
        },
      });
      for (const b of bills) {
        const base = inBase(b.currency, b.rate);
        for (const l of b.lines)
          lines.push({
            documentId: b.id,
            contact: b.contact,
            item: l.item,
            quantity: qty(l.quantity),
            net: base(l.amount),
            tax: base(l.taxAmount),
            sign: 1,
          });
      }
    }
    return {
      side,
      by,
      from,
      to,
      baseCurrency,
      ...buildSalesReport(lines, by),
    };
  }

  csv(r: Awaited<ReturnType<SalesReportService['report']>>) {
    return `﻿${salesReportRows(r, currencyDigits(r.baseCurrency))
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}\r\n`;
  }
}
