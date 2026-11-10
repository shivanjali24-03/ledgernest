import { Injectable } from '@nestjs/common';
import {
  instalmentInterest,
  type Instalment,
  type InterestEvent,
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
        instalments: true,
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
      const plan = (i.instalments as Instalment[] | null) ?? null;
      const r = (
        plan?.length
          ? (t: InterestTerms, _i: unknown, e: InterestEvent[], d: string) =>
              instalmentInterest(t, plan, e, d)
          : accruedInterest
      )(
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

  /**
   * Interest on late payment across the books on a day: each invoice with interest terms that has accrued any,
   * with what's been invoiced for it and waived, and what's left to charge; by customer, and in total.
   */
  async report(organizationId: string, asOf: string) {
    const accrued = await this.forInvoices(organizationId, {}, asOf);
    const ids = [...accrued.keys()];
    const [invoices, charged, waived] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { organizationId, id: { in: ids } },
        select: {
          id: true,
          fullNumber: true,
          dueDate: true,
          total: true,
          amountPaid: true,
          contact: { select: { id: true, name: true } },
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['interestOnInvoiceId'],
        where: {
          organizationId,
          interestOnInvoiceId: { in: ids },
          status: { not: 'void' },
          issueDate: { lte: asDate(asOf) },
        },
        _sum: { subtotal: true },
      }),
      this.prisma.interestWaiver.groupBy({
        by: ['invoiceId'],
        where: {
          organizationId,
          invoiceId: { in: ids },
          date: { lte: asDate(asOf) },
        },
        _sum: { amount: true },
      }),
    ]);
    const chargedOn = new Map(
      charged.map((c) => [
        c.interestOnInvoiceId!,
        Number(c._sum.subtotal ?? 0),
      ]),
    );
    const waivedOn = new Map(
      waived.map((w) => [w.invoiceId, Number(w._sum.amount ?? 0)]),
    );
    const rows = invoices
      .map((i) => {
        const a = accrued.get(i.id)!;
        const c = chargedOn.get(i.id) ?? 0;
        const w = waivedOn.get(i.id) ?? 0;
        return {
          invoiceId: i.id,
          number: i.fullNumber,
          contact: i.contact,
          currency: a.currency,
          dueDate: iso(i.dueDate),
          daysLate: a.daysLate,
          rateBp: a.rateBp,
          balance: Number(i.total - i.amountPaid),
          accrued: a.accrued,
          perDay: a.perDay,
          charged: c,
          waived: w,
          chargeable: Math.max(0, a.accrued - c - w),
        };
      })
      .filter((r) => r.accrued > 0 || r.charged > 0 || r.waived > 0)
      .sort(
        (x, y) =>
          x.contact.name.localeCompare(y.contact.name) ||
          x.dueDate.localeCompare(y.dueDate),
      );
    const sum = (
      k: 'accrued' | 'charged' | 'waived' | 'chargeable' | 'perDay',
    ) => rows.filter((r) => !r.currency).reduce((s, r) => s + r[k], 0);
    return {
      asOf,
      rows,
      /** Base-currency invoices together (foreign-currency ones are listed but not added in) */
      totals: {
        accrued: sum('accrued'),
        charged: sum('charged'),
        waived: sum('waived'),
        chargeable: sum('chargeable'),
        perDay: sum('perDay'),
      },
    };
  }
}
