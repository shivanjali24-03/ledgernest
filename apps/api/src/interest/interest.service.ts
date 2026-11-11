import { Injectable } from '@nestjs/common';
import {
  accruedInterest,
  type InterestMethod,
  type InterestTerms,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export interface InvoiceInterest extends InterestTerms {
  /** The invoice's currency; null = the base currency */
  currency: string | null;
  /** Interest to the day asked for (smallest unit of the invoice's currency) */
  accrued: number;
  perDay: number;
  daysLate: number;
  inGrace: boolean;
}

/**
 * Interest on late payment across many invoices at once (for statements, the customer's link, reminders, the
 * aging report and Collections): each under the terms it was issued with, counting the payments and credits
 * made up to the day asked for.
 */
@Injectable()
export class InterestService {
  constructor(private readonly prisma: PrismaService) {}

  async forInvoices(
    organizationId: string,
    where: { ids?: string[]; contactId?: string },
    asOf: string,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'issued',
        interestRateBp: { gt: 0 },
        interestMethod: { not: null },
        issueDate: { lte: asDate(asOf) },
        ...(where.ids && { id: { in: where.ids } }),
        ...(where.contactId && { contactId: where.contactId }),
      },
      select: {
        id: true,
        currency: true,
        total: true,
        dueDate: true,
        interestRateBp: true,
        interestMethod: true,
        interestGraceDays: true,
        allocations: {
          where: {
            payment: { status: 'posted', date: { lte: asDate(asOf) } },
          },
          select: { amount: true, payment: { select: { date: true } } },
        },
        credits: {
          where: {
            date: { lte: asDate(asOf) },
            creditNote: { status: 'issued' },
          },
          select: { amount: true, date: true },
        },
      },
    });
    const out = new Map<string, InvoiceInterest>();
    for (const i of invoices) {
      const terms: InterestTerms = {
        rateBp: i.interestRateBp!,
        method: i.interestMethod as InterestMethod,
        graceDays: i.interestGraceDays ?? 0,
      };
      const r = accruedInterest(
        terms,
        { total: Number(i.total), dueDate: iso(i.dueDate) },
        [
          ...i.allocations.map((a) => ({
            date: iso(a.payment.date),
            amount: Number(a.amount),
          })),
          ...i.credits.map((c) => ({
            date: iso(c.date),
            amount: Number(c.amount),
          })),
        ],
        asOf,
      );
      out.set(i.id, {
        ...terms,
        currency: i.currency,
        accrued: r.interest,
        perDay: r.perDay,
        daysLate: r.daysLate,
        inGrace: r.inGrace,
      });
    }
    return out;
  }
}
