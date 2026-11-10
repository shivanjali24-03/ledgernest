import { Injectable } from '@nestjs/common';
import {
  addDays,
  billNumber,
  buildCashForecast,
  currencyDigits,
  invoiceAmounts,
  invoiceNumber,
  nextOccurrence,
  todayIn,
  toBase,
  usualLateness,
  type ForecastItem,
  type RecurringFrequency,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
type TemplateLine = {
  quantity: string;
  unitPrice: number;
  discount?: number;
  taxGroupId: string | null;
};

/**
 * The cash forecast from the books: cash and bank today; customers' unpaid invoices on the day each customer
 * usually pays (learned from the last year of paid invoices); unpaid bills on their due dates; and what repeat
 * invoices and bills will raise, due after the contact's terms. Week by week, with the first week cash runs short.
 */
@Injectable()
export class CashForecastService {
  constructor(private readonly prisma: PrismaService) {}

  async forecast(organizationId: string, weeks: number) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true, baseCurrency: true },
    });
    const today = todayIn(org.timeZone);
    const horizon = addDays(today, weeks * 7);
    const yearAgo = addDays(today, -365);
    const inBase = (
      minor: number,
      currency: string | null,
      rate: { toString(): string } | null,
    ) =>
      currency && rate
        ? toBase(
            minor,
            rate.toString(),
            currencyDigits(currency),
            currencyDigits(org.baseCurrency),
          )
        : minor;

    const [cash, invoices, paid, bills, recurringInvoices, recurringBills] =
      await Promise.all([
        this.prisma.$queryRaw<{ total: bigint | null }[]>`
          SELECT sum(l.debit - l.credit)::bigint AS total
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
          JOIN accounts a ON a.id = l.account_id
          WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date <= ${asDate(today)}::date
            AND a.type = 'asset' AND a.subtype IN ('bank', 'cash')`,
        this.prisma.invoice.findMany({
          where: { organizationId, status: 'issued' },
          select: {
            id: true,
            number: true,
            dueDate: true,
            currency: true,
            rate: true,
            total: true,
            amountPaid: true,
            fiscalYear: { select: { name: true } },
            contact: { select: { id: true, name: true } },
          },
        }),
        // Invoices paid in full in the last year, with the day the last money came in
        this.prisma.$queryRaw<
          { contact_id: string; due_date: Date; paid_on: Date }[]
        >`
          SELECT i.contact_id, i.due_date, max(p.date) AS paid_on
          FROM invoices i
          JOIN payment_allocations pa ON pa.invoice_id = i.id
          JOIN payments p ON p.id = pa.payment_id
          WHERE i.organization_id = ${organizationId}::uuid AND i.status = 'issued' AND i.amount_paid >= i.total
            AND p.date >= ${asDate(yearAgo)}::date
          GROUP BY i.id, i.contact_id, i.due_date`,
        this.prisma.bill.findMany({
          where: { organizationId, status: 'open' },
          select: {
            id: true,
            number: true,
            vendorReference: true,
            dueDate: true,
            currency: true,
            rate: true,
            total: true,
            amountPaid: true,
            fiscalYear: { select: { name: true } },
            contact: { select: { id: true, name: true } },
          },
        }),
        this.prisma.recurringInvoice.findMany({
          where: {
            organizationId,
            status: 'active',
            nextDate: { not: null, lte: asDate(horizon) },
          },
          select: {
            id: true,
            name: true,
            startDate: true,
            frequency: true,
            interval: true,
            endDate: true,
            maxCount: true,
            count: true,
            template: true,
            contact: {
              select: {
                id: true,
                name: true,
                currency: true,
                paymentTermsDays: true,
              },
            },
          },
        }),
        this.prisma.recurringBill.findMany({
          where: {
            organizationId,
            status: 'active',
            nextDate: { not: null, lte: asDate(horizon) },
          },
          select: {
            id: true,
            name: true,
            startDate: true,
            frequency: true,
            interval: true,
            endDate: true,
            maxCount: true,
            count: true,
            template: true,
            contact: {
              select: {
                id: true,
                name: true,
                currency: true,
                paymentTermsDays: true,
              },
            },
          },
        }),
      ]);

    // How late each customer usually pays
    const history = new Map<string, { dueDate: string; paidOn: string }[]>();
    for (const p of paid) {
      const list = history.get(p.contact_id) ?? [];
      list.push({ dueDate: iso(p.due_date), paidOn: iso(p.paid_on) });
      history.set(p.contact_id, list);
    }
    const lateness = new Map(
      [...history].map(([id, list]) => [id, usualLateness(list) ?? 0]),
    );

    const items: ForecastItem[] = [];
    for (const i of invoices) {
      const balance = Number(i.total - i.amountPaid);
      if (balance <= 0) continue;
      items.push({
        kind: 'invoice',
        id: i.id,
        label:
          i.number && i.fiscalYear
            ? invoiceNumber(i.fiscalYear.name, i.number)
            : 'Invoice',
        contact: i.contact,
        dueDate: iso(i.dueDate),
        amount: inBase(balance, i.currency, i.rate),
        lateDays: lateness.get(i.contact.id) ?? 0,
      });
    }
    for (const b of bills) {
      const balance = Number(b.total - b.amountPaid);
      if (balance <= 0) continue;
      items.push({
        kind: 'bill',
        id: b.id,
        label:
          b.vendorReference ??
          (b.number && b.fiscalYear
            ? billNumber(b.fiscalYear.name, b.number)
            : 'Bill'),
        contact: b.contact,
        dueDate: iso(b.dueDate),
        amount: -inBase(balance, b.currency, b.rate),
      });
    }

    // What schedules will raise: amounts from the template's current prices and tax, in rupees only (a schedule
    // in another currency has no rate yet, so it's left out rather than guessed)
    const schedules = [
      ...recurringInvoices.map((r) => ({
        ...r,
        kind: 'recurring_invoice' as const,
      })),
      ...recurringBills.map((r) => ({ ...r, kind: 'recurring_bill' as const })),
    ].filter(
      (r) => !r.contact.currency || r.contact.currency === org.baseCurrency,
    );
    const groupIds = [
      ...new Set(
        schedules
          .flatMap((r) =>
            (r.template as { lines: TemplateLine[] }).lines.map(
              (l) => l.taxGroupId,
            ),
          )
          .filter((g): g is string => !!g),
      ),
    ];
    const groups = await this.prisma.taxGroup.findMany({
      where: { organizationId, id: { in: groupIds } },
      select: {
        id: true,
        rates: { select: { rate: { select: { id: true, ratePpm: true } } } },
      },
    });
    for (const r of schedules) {
      const lines = (r.template as { lines: TemplateLine[] }).lines;
      const total = invoiceAmounts(
        lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPpm: l.discount ?? 0,
          rates: (groups.find((g) => g.id === l.taxGroupId)?.rates ?? []).map(
            (x) => ({ rateId: x.rate.id, ratePpm: x.rate.ratePpm }),
          ),
        })),
      ).total;
      const s = {
        startDate: iso(r.startDate),
        frequency: r.frequency as RecurringFrequency,
        interval: r.interval,
        endDate: r.endDate && iso(r.endDate),
        maxCount: r.maxCount,
      };
      for (let n = r.count, k = 0; k < 60; n++, k++) {
        const raised = nextOccurrence(s, n);
        if (!raised || raised > horizon) break;
        items.push({
          kind: r.kind,
          id: r.id,
          label: r.name,
          contact: { id: r.contact.id, name: r.contact.name },
          dueDate: addDays(raised, r.contact.paymentTermsDays),
          amount: r.kind === 'recurring_invoice' ? total : -total,
          lateDays:
            r.kind === 'recurring_invoice'
              ? (lateness.get(r.contact.id) ?? 0)
              : undefined,
        });
      }
    }

    const f = buildCashForecast({
      today,
      opening: Number(cash[0]?.total ?? 0),
      items,
      weeks,
    });
    // Customers who pay late, worst first: what the forecast assumed
    const late = [...lateness]
      .filter(([, d]) => d > 0)
      .map(([id, days]) => ({
        contact: invoices.find((i) => i.contact.id === id)?.contact ?? {
          id,
          name: '',
        },
        days,
      }))
      .filter((x) => x.contact.name)
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);
    return { ...f, currency: org.baseCurrency, lateCustomers: late };
  }
}
