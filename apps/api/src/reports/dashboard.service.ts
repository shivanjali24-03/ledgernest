import { Injectable } from '@nestjs/common';
import {
  currencyDigits,
  fiscalYearOf,
  fiscalYearSpan,
  todayIn,
  toBase,
  type OrganizationPermission,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const monthOf = (day: string) => day.slice(0, 7);
const monthsBack = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * The business at a glance, from the books themselves: cash, what customers owe and what's owed to vendors,
 * profit this financial year, twelve months of trend, what needs attention (only what the reader may see), and
 * how far setting up has got.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(
    organizationId: string,
    permissions: ReadonlySet<OrganizationPermission>,
    /** Who's looking: what they sent for approval isn't theirs to approve */
    actorId?: string,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        timeZone: true,
        baseCurrency: true,
        fiscalYearStartMonth: true,
        taxId: true,
        addressLine1: true,
      },
    });
    const today = todayIn(org.timeZone);
    const thisMonth = monthOf(today);
    const months = Array.from({ length: 12 }, (_v, k) =>
      monthsBack(thisMonth, 11 - k),
    );
    const yearStart = fiscalYearSpan(
      fiscalYearOf(today, org.fiscalYearStartMonth),
      org.fiscalYearStartMonth,
    ).startDate;

    // Each account's movement per month, without year-end closings (they only move profit to retained earnings)
    const [accounts, moves] = await Promise.all([
      this.prisma.account.findMany({
        where: { organizationId },
        select: { id: true, type: true, subtype: true },
      }),
      this.prisma.$queryRaw<
        { account_id: string; month: string; net: bigint }[]
      >`
        SELECT l.account_id, to_char(e.date, 'YYYY-MM') AS month, sum(l.debit - l.credit)::bigint AS net
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date <= ${asDate(today)}::date
          AND e.id NOT IN (SELECT closing_entry_id FROM fiscal_years WHERE organization_id = ${organizationId}::uuid AND closing_entry_id IS NOT NULL)
        GROUP BY 1, 2`,
    ]);
    const kind = new Map(
      accounts.map((a) => [
        a.id,
        a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash')
          ? 'cash'
          : a.subtype === 'accounts_receivable'
            ? 'receivables'
            : a.subtype === 'accounts_payable'
              ? 'payables'
              : a.type === 'income'
                ? 'income'
                : a.type === 'expense'
                  ? 'expense'
                  : null,
      ]),
    );
    const sumUpTo = (k: string, month: string) =>
      moves
        .filter((m) => kind.get(m.account_id) === k && m.month <= month)
        .reduce((s, m) => s + Number(m.net), 0);
    const inMonth = (k: string, month: string) =>
      moves
        .filter((m) => kind.get(m.account_id) === k && m.month === month)
        .reduce((s, m) => s + Number(m.net), 0);
    const monthly = months.map((m) => {
      const income = -inMonth('income', m);
      const expenses = inMonth('expense', m);
      return {
        month: m,
        income,
        expenses,
        profit: income - expenses,
        cash: sumUpTo('cash', m),
      };
    });
    const lastMonth = months[10]!;
    const ytd = (upTo: string) =>
      moves
        .filter(
          (m) =>
            (kind.get(m.account_id) === 'income' ||
              kind.get(m.account_id) === 'expense') &&
            m.month >= monthOf(yearStart) &&
            m.month <= upTo,
        )
        .reduce((s, m) => s - Number(m.net), 0);
    const balance = (k: 'cash' | 'receivables' | 'payables', month: string) =>
      (k === 'payables' ? -1 : 1) * sumUpTo(k, month);
    const kpi = (k: 'cash' | 'receivables' | 'payables') => ({
      value: balance(k, thisMonth),
      previous: balance(k, lastMonth),
      trend: months.map((m) => balance(k, m)),
    });
    const kpis = {
      cash: kpi('cash'),
      receivables: kpi('receivables'),
      payables: kpi('payables'),
      // Profit so far this financial year, against where it stood at the end of last month
      profit: {
        value: ytd(thisMonth),
        previous: thisMonth === monthOf(yearStart) ? 0 : ytd(lastMonth),
        trend: monthly.map((m) => m.profit),
        since: yearStart,
      },
    };

    const inBase = (
      minor: bigint,
      currency: string | null,
      rate: { toString(): string } | null,
    ) =>
      currency && rate
        ? toBase(
            Number(minor),
            rate.toString(),
            currencyDigits(currency),
            currencyDigits(org.baseCurrency),
          )
        : Number(minor);
    const alerts: { kind: string; count: number; amount?: number }[] = [];
    if (permissions.has('invoices.view')) {
      const overdue = (
        await this.prisma.invoice.findMany({
          where: {
            organizationId,
            status: 'issued',
            dueDate: { lt: asDate(today) },
          },
          select: { total: true, amountPaid: true, currency: true, rate: true },
        })
      ).filter((i) => i.total > i.amountPaid);
      if (overdue.length)
        alerts.push({
          kind: 'overdue_invoices',
          count: overdue.length,
          amount: overdue.reduce(
            (s, i) => s + inBase(i.total - i.amountPaid, i.currency, i.rate),
            0,
          ),
        });
      const recurring = await this.prisma.recurringInvoice.count({
        where: {
          organizationId,
          status: 'active',
          nextDate: { lte: asDate(today) },
        },
      });
      if (recurring) alerts.push({ kind: 'recurring_due', count: recurring });
    }
    if (permissions.has('bills.view')) {
      // Bill schedules with a date that should have been made by now (a run failed or hasn't happened)
      const bills = await this.prisma.recurringBill.count({
        where: {
          organizationId,
          status: 'active',
          nextDate: { lte: asDate(today) },
        },
      });
      if (bills) alerts.push({ kind: 'recurring_bills_due', count: bills });
      const overdue = (
        await this.prisma.bill.findMany({
          where: {
            organizationId,
            status: 'open',
            dueDate: { lt: asDate(today) },
          },
          select: { total: true, amountPaid: true, currency: true, rate: true },
        })
      ).filter((b) => b.total > b.amountPaid);
      if (overdue.length)
        alerts.push({
          kind: 'overdue_bills',
          count: overdue.length,
          amount: overdue.reduce(
            (s, b) => s + inBase(b.total - b.amountPaid, b.currency, b.rate),
            0,
          ),
        });
      // What falls due in the coming week, to plan the cash for
      const weekOn = asDate(today);
      weekOn.setUTCDate(weekOn.getUTCDate() + 7);
      const soon = (
        await this.prisma.bill.findMany({
          where: {
            organizationId,
            status: 'open',
            dueDate: { gte: asDate(today), lte: weekOn },
          },
          select: { total: true, amountPaid: true, currency: true, rate: true },
        })
      ).filter((b) => b.total > b.amountPaid);
      if (soon.length)
        alerts.push({
          kind: 'bills_due_soon',
          count: soon.length,
          amount: soon.reduce(
            (s, b) => s + inBase(b.total - b.amountPaid, b.currency, b.rate),
            0,
          ),
        });
    }
    if (permissions.has('banking.view')) {
      const lines = await this.prisma.bankStatementLine.count({
        where: { organizationId, status: 'unmatched' },
      });
      if (lines) alerts.push({ kind: 'unreconciled', count: lines });
    }
    if (permissions.has('journals.view')) {
      const open = await this.prisma.period.count({
        where: {
          organizationId,
          status: 'open',
          endDate: { lt: asDate(`${thisMonth}-01`) },
        },
      });
      if (open) alerts.push({ kind: 'open_periods', count: open });
      const drafts = await this.prisma.journalEntry.count({
        where: { organizationId, status: 'draft' },
      });
      if (drafts) alerts.push({ kind: 'draft_entries', count: drafts });
    }
    if (permissions.has('invoices.view')) {
      // Tracked goods at or below their reorder level
      const [low] = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM items i
        WHERE i.organization_id = ${organizationId}::uuid AND i.track_stock AND i.archived_at IS NULL AND i.reorder_level IS NOT NULL
          AND coalesce((SELECT sum(m.quantity) FROM stock_movements m WHERE m.item_id = i.id), 0) <= i.reorder_level`;
      if (low && Number(low.n))
        alerts.push({ kind: 'low_stock', count: Number(low.n) });
      // Open quotes running out within the week
      const weekOn = asDate(today);
      weekOn.setUTCDate(weekOn.getUTCDate() + 7);
      const expiring = await this.prisma.quote.count({
        where: {
          organizationId,
          status: { in: ['draft', 'sent'] },
          expiryDate: { gte: asDate(today), lte: weekOn },
        },
      });
      if (expiring) alerts.push({ kind: 'quotes_expiring', count: expiring });
    }
    if (permissions.has('approvals.approve')) {
      const waiting = await this.prisma.approvalRequest.count({
        where: {
          organizationId,
          status: 'pending',
          ...(actorId && { requestedById: { not: actorId } }),
        },
      });
      if (waiting) alerts.push({ kind: 'approvals_waiting', count: waiting });
    }

    const [members, invitations, accountCount, years, banks] =
      await Promise.all([
        this.prisma.membership.count({ where: { organizationId } }),
        this.prisma.invitation.count({
          where: { organizationId, acceptedAt: null, revokedAt: null },
        }),
        this.prisma.account.count({ where: { organizationId } }),
        this.prisma.fiscalYear.count({ where: { organizationId } }),
        this.prisma.account.count({
          where: {
            organizationId,
            type: 'asset',
            subtype: { in: ['bank', 'cash'] },
            archivedAt: null,
          },
        }),
      ]);
    const setup = {
      organisation: !!(org.taxId || org.addressLine1),
      team: members > 1 || invitations > 0,
      coa: accountCount > 0,
      fiscal: years > 0,
      bank: banks > 0,
    };

    return {
      asOf: today,
      baseCurrency: org.baseCurrency,
      monthEnd: monthEnd(lastMonth),
      kpis,
      monthly,
      alerts,
      setup,
    };
  }
}
