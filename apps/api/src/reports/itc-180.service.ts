import { Injectable } from '@nestjs/common';
import {
  billNumber,
  itcBillStatus,
  itcRule37ForPeriod,
  splitTax,
  todayIn,
  zeroHeads,
  type GstHeads,
  type ItcBillInput,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const head = (kind: string): keyof GstHeads | null =>
  kind === 'igst'
    ? 'igst'
    : kind === 'cgst'
      ? 'cgst'
      : kind === 'sgst' || kind === 'utgst'
        ? 'sgst'
        : kind === 'cess'
          ? 'cess'
          : null;

/**
 * Rule 37: suppliers paid within 180 days of their invoice, or the credit taken on their bills is reversed (shared
 * itc/). Rupee bills with credit taken; reverse-charge bills don't count.
 */
@Injectable()
export class Itc180Service {
  constructor(private readonly prisma: PrismaService) {}

  /** Recorded bills with credit taken, dated on or before the day, with what settled them */
  private async bills(organizationId: string, asOf: string) {
    const rows = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: 'open',
        currency: null,
        reverseCharge: false,
        billDate: { lte: asDate(asOf) },
        lines: { some: { taxGroupId: { not: null }, itc: 'eligible' } },
      },
      orderBy: [{ billDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        billDate: true,
        vendorBillDate: true,
        vendorReference: true,
        total: true,
        fiscalYear: { select: { name: true } },
        contact: { select: { id: true, name: true } },
        lines: {
          where: { taxGroupId: { not: null }, itc: 'eligible' },
          select: {
            amount: true,
            taxGroup: {
              select: {
                rates: {
                  select: {
                    rate: { select: { id: true, kind: true, ratePpm: true } },
                  },
                },
              },
            },
          },
        },
        allocations: {
          where: { payment: { status: 'posted' } },
          select: { amount: true, payment: { select: { date: true } } },
        },
        vendorCreditApplications: { select: { date: true, amount: true } },
      },
    });
    return rows.map((b) => {
      const credit = zeroHeads();
      for (const l of b.lines) {
        const rates = l.taxGroup?.rates ?? [];
        splitTax(
          Number(l.amount),
          false,
          rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
        ).taxes.forEach((t, k) => {
          const h = head(rates[k]!.rate.kind);
          if (h) credit[h] += t.amount;
        });
      }
      const input: ItcBillInput = {
        id: b.id,
        invoiceDate: iso(b.vendorBillDate ?? b.billDate),
        total: Number(b.total),
        credit,
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
      };
      return { row: b, input };
    });
  }

  /** Bills whose credit is at risk (due in 30 days), to reverse (past 180 days unpaid) or to take back (paid since) */
  async report(organizationId: string, date?: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    const asOf = date ?? todayIn(timeZone);
    const bills = (await this.bills(organizationId, asOf))
      .map(({ row, input }) => {
        const s = itcBillStatus(input, asOf);
        return {
          ...s,
          number:
            row.number && row.fiscalYear
              ? billNumber(row.fiscalYear.name, row.number)
              : null,
          vendorReference: row.vendorReference,
          vendor: row.contact,
          invoiceDate: input.invoiceDate,
          total: input.total,
        };
      })
      .filter((b) => b.state !== 'ok')
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
    const sum = (state: string, f: (b: (typeof bills)[number]) => GstHeads) =>
      bills
        .filter((b) => b.state === state)
        .reduce((s, b) => {
          const h = f(b);
          return s + h.igst + h.cgst + h.sgst + h.cess;
        }, 0);
    return {
      asOf,
      bills,
      totals: {
        dueSoon: sum('due_soon', (b) => b.atRisk),
        reverse: sum('reverse', (b) => b.reversed),
        reclaim: sum('reclaim', (b) => b.reclaimable),
      },
    };
  }

  /** For GSTR-3B: credit to reverse (4(B)(2)) and to take back (4(D)(1)) in the period */
  async forPeriod(organizationId: string, from: string, to: string) {
    return itcRule37ForPeriod(
      (await this.bills(organizationId, to)).map((b) => b.input),
      from,
      to,
    );
  }
}
