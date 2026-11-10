import { Injectable } from '@nestjs/common';
import {
  billNumber,
  fiscalYearOf,
  fiscalYearSpan,
  msmeReport,
  todayIn,
  type MsmeBillInput,
  type MsmeCategory,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Bills from micro and small suppliers (by the Udyam category on the vendor) against the 45-day rule: each bill's
 * deadline and state on the day, and what income-tax section 43B(h) would take out of the year's profit.
 */
@Injectable()
export class MsmeReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(organizationId: string, date?: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true, fiscalYearStartMonth: true },
    });
    const asOf = date ?? todayIn(org.timeZone);
    const span = fiscalYearSpan(
      fiscalYearOf(asOf, org.fiscalYearStartMonth),
      org.fiscalYearStartMonth,
    );
    const fiscalYear = {
      from: span.periods[0]!.startDate,
      to: span.periods[11]!.endDate,
    };
    const rows = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: 'open',
        currency: null,
        billDate: { lte: asDate(asOf) },
        contact: { msmeCategory: { in: ['micro', 'small'] } },
        // This year's, and any from before that are still owed
        OR: [
          { billDate: { gte: asDate(fiscalYear.from) } },
          { amountPaid: { lt: this.prisma.bill.fields.total } },
          {
            allocations: { some: { payment: { date: { gt: asDate(asOf) } } } },
          },
        ],
      },
      orderBy: [{ billDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        vendorReference: true,
        billDate: true,
        dueDate: true,
        total: true,
        subtotal: true,
        fiscalYear: { select: { name: true } },
        contact: {
          select: {
            id: true,
            name: true,
            msmeCategory: true,
            udyamNumber: true,
          },
        },
        allocations: {
          where: { payment: { status: 'posted' } },
          select: { amount: true, payment: { select: { date: true } } },
        },
        vendorCreditApplications: { select: { date: true, amount: true } },
      },
    });
    const bills: MsmeBillInput[] = rows.map((b) => ({
      id: b.id,
      number:
        b.number && b.fiscalYear
          ? billNumber(b.fiscalYear.name, b.number)
          : (b.vendorReference ?? ''),
      vendor: {
        id: b.contact.id,
        name: b.contact.name,
        category: b.contact.msmeCategory as MsmeCategory,
        udyamNumber: b.contact.udyamNumber,
      },
      billDate: iso(b.billDate),
      dueDate: iso(b.dueDate),
      total: Number(b.total),
      subtotal: Number(b.subtotal),
      settlements: [
        ...b.allocations.map((a) => ({
          date: iso(a.payment.date),
          amount: Number(a.amount),
        })),
        ...b.vendorCreditApplications.map((a) => ({
          date: iso(a.date),
          amount: Number(a.amount),
        })),
      ],
    }));
    const r = msmeReport(bills, asOf, fiscalYear);
    return {
      ...r,
      bills: r.bills.map((b) => ({
        ...b,
        vendorReference:
          rows.find((x) => x.id === b.id)?.vendorReference ?? null,
      })),
    };
  }
}
