import { Injectable } from '@nestjs/common';
import { panFromGstin, paymentNumber, tdsDepositDue } from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * TDS kept back from vendor payments in some dates: by section (for the quarterly Form 26Q), by month with the day
 * it's due to the government (challan 281), and each payment with the vendor's PAN.
 */
@Injectable()
export class TdsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(organizationId: string, from: string, to: string) {
    const rows = await this.prisma.payment.findMany({
      where: {
        organizationId,
        kind: 'payment',
        status: 'posted',
        tdsAmount: { gt: 0 },
        date: { gte: asDate(from), lte: asDate(to) },
      },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        kind: true,
        number: true,
        date: true,
        amount: true,
        tdsSection: true,
        tdsRatePpm: true,
        tdsBase: true,
        tdsAmount: true,
        fiscalYear: { select: { name: true } },
        contact: {
          select: { id: true, name: true, legalName: true, taxId: true },
        },
      },
    });
    const payments = rows.map((p) => ({
      id: p.id,
      number: paymentNumber('payment', p.fiscalYear.name, p.number),
      date: iso(p.date),
      vendor: {
        id: p.contact.id,
        name: p.contact.legalName ?? p.contact.name,
        pan: panFromGstin(p.contact.taxId),
      },
      section: p.tdsSection!,
      ratePpm: p.tdsRatePpm!,
      base: Number(p.tdsBase),
      amount: Number(p.amount),
      tds: Number(p.tdsAmount),
    }));
    const group = <K extends string>(
      key: (p: (typeof payments)[number]) => K,
    ) => {
      const m = new Map<K, { count: number; base: number; tds: number }>();
      for (const p of payments) {
        const g = m.get(key(p)) ?? { count: 0, base: 0, tds: 0 };
        g.count++;
        g.base += p.base;
        g.tds += p.tds;
        m.set(key(p), g);
      }
      return m;
    };
    return {
      from,
      to,
      total: payments.reduce((s, p) => s + p.tds, 0),
      sections: [...group((p) => p.section)]
        .map(([section, g]) => ({ section, ...g }))
        .sort((a, b) => a.section.localeCompare(b.section)),
      months: [...group((p) => p.date.slice(0, 7))]
        .map(([month, g]) => ({ month, due: tdsDepositDue(month), ...g }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      /** Deductees without a PAN on file: 26Q needs one, and TDS is 20% without it */
      missingPan: [
        ...new Set(
          payments.filter((p) => !p.vendor.pan).map((p) => p.vendor.name),
        ),
      ],
      payments,
    };
  }

  /** TDS kept back each month (yyyy-mm → paise), for the due-dates list */
  async byMonth(organizationId: string, from: string, to: string) {
    const rows = await this.prisma.$queryRaw<{ month: string; tds: bigint }[]>`
      SELECT to_char(date, 'YYYY-MM') AS month, sum(tds_amount)::bigint AS tds
      FROM payments
      WHERE organization_id = ${organizationId}::uuid AND kind = 'payment' AND status = 'posted' AND tds_amount > 0
        AND date >= ${asDate(from)}::date AND date <= ${asDate(to)}::date
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.month, Number(r.tds)]));
  }
}
