import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fiscalYearName, fiscalYearOf, fiscalYearSpan, journalNumber, todayIn } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

/** Prisma returns @db.Date columns as UTC midnight; the API speaks in "YYYY-MM-DD" days. */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const periodSelect = { id: true, number: true, startDate: true, endDate: true, status: true, closedAt: true, closeReason: true, closedBy: { select: { name: true, email: true } } } as const;

/**
 * Financial years and their monthly periods.
 * Periods close in order (the earliest open one) and reopen in reverse (the latest closed one),
 * so "everything up to date X is final" is always a single, simple statement.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'periods:' + organizationId}))`;
  }

  async list(organizationId: string) {
    const [org, years] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { fiscalYearStartMonth: true, timeZone: true } }),
      this.prisma.fiscalYear.findMany({
        where: { organizationId },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, startDate: true, endDate: true, closingEntry: { select: { id: true, number: true } }, periods: { orderBy: { number: 'asc' }, select: periodSelect } },
      }),
    ]);
    const all = years.flatMap((y) => y.periods).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const firstOpen = all.find((p) => p.status === 'open');
    const lastClosed = [...all].reverse().find((p) => p.status === 'closed');
    const today = todayIn(org.timeZone);
    const first = years[years.length - 1];
    const last = years[0];
    const startMonth = org.fiscalYearStartMonth;
    return {
      today,
      fiscalYearStartMonth: startMonth,
      // What "Add financial year" would create next (after the last one, or the current year when there are none)
      next: last ? Number(iso(last.endDate).slice(0, 4)) + (startMonth === 1 ? 1 : 0) : fiscalYearOf(today, startMonth),
      // For entering history: the year before the first one
      previous: first ? Number(iso(first.startDate).slice(0, 4)) - 1 : null,
      years: years.map((y) => ({
        id: y.id,
        name: y.name,
        startDate: iso(y.startDate),
        endDate: iso(y.endDate),
        current: iso(y.startDate) <= today && today <= iso(y.endDate),
        closed: y.periods.every((p) => p.status === 'closed'),
        /** The entry that moved the year's profit to retained earnings */
        closingEntry: y.closingEntry && { id: y.closingEntry.id, number: journalNumber(y.name, y.closingEntry.number!) },
        periods: y.periods.map((p) => ({
          id: p.id,
          number: p.number,
          startDate: iso(p.startDate),
          endDate: iso(p.endDate),
          status: p.status,
          closedAt: p.closedAt,
          closedBy: p.closedBy,
          closeReason: p.closeReason,
          current: iso(p.startDate) <= today && today <= iso(p.endDate),
          canClose: p.id === firstOpen?.id,
          canReopen: p.id === lastClosed?.id,
        })),
      })),
    };
  }

  /** Adds a financial year right after the last one, or right before the first (for entering history). */
  async createYear(startYear: number, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { fiscalYearStartMonth: true } });
      const span = fiscalYearSpan(startYear, org.fiscalYearStartMonth);
      const [first, last] = await Promise.all([
        tx.fiscalYear.findFirst({ where: { organizationId }, orderBy: { startDate: 'asc' }, select: { startDate: true } }),
        tx.fiscalYear.findFirst({ where: { organizationId }, orderBy: { startDate: 'desc' }, select: { endDate: true } }),
      ]);
      if (first && last) {
        const dayAfterLast = iso(new Date(last.endDate.getTime() + 86_400_000));
        const dayBeforeFirst = iso(new Date(first.startDate.getTime() - 86_400_000));
        if (span.startDate !== dayAfterLast && span.endDate !== dayBeforeFirst) {
          if (span.startDate >= iso(first.startDate) && span.startDate <= iso(last.endDate)) throw refuse(ConflictException, 'That financial year already exists.', 'exists');
          throw refuse(BadRequestException, 'Financial years must follow on from each other without gaps.', 'not_contiguous');
        }
      }
      const name = fiscalYearName(startYear, org.fiscalYearStartMonth);
      const year = await tx.fiscalYear.create({
        data: {
          organizationId,
          name,
          startDate: asDate(span.startDate),
          endDate: asDate(span.endDate),
        },
        select: { id: true },
      });
      await tx.period.createMany({ data: span.periods.map((p) => ({ organizationId, fiscalYearId: year.id, number: p.number, startDate: asDate(p.startDate), endDate: asDate(p.endDate) })) });
      await this.audit.record({ action: 'org.fiscal_year.create', actorId: ctx.actor.userId, organizationId, entityType: 'fiscal_year', entityId: year.id, after: { name, startDate: span.startDate, endDate: span.endDate }, req: ctx.req }, tx);
      return { id: year.id, name, startDate: span.startDate, endDate: span.endDate };
    });
  }

  private async findPeriod(tx: Tx | PrismaService, organizationId: string, id: string) {
    const p = await tx.period.findFirst({
      where: { id, organizationId },
      select: { id: true, number: true, startDate: true, endDate: true, status: true, fiscalYear: { select: { id: true, name: true, startDate: true, endDate: true, closingEntryId: true, _count: { select: { periods: true } } } } },
    });
    if (!p) throw new NotFoundException('Period not found.');
    return p;
  }

  /**
   * What closing a year moves: every income and expense account's balance for the year, as the lines that bring
   * it to zero, and the profit (or loss, when negative) that goes to retained earnings.
   */
  private static async yearEnd(tx: Tx | PrismaService, organizationId: string, year: { startDate: Date; endDate: Date }) {
    const rows = await tx.$queryRaw<{ account_id: string; net: bigint }[]>`
      SELECT l.account_id, (sum(l.debit) - sum(l.credit))::bigint AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND a.type IN ('income', 'expense')
        AND e.date BETWEEN ${year.startDate}::date AND ${year.endDate}::date
      GROUP BY l.account_id
      HAVING sum(l.debit) <> sum(l.credit)`;
    const lines = rows.map((r) => {
      const net = Number(r.net);
      return { accountId: r.account_id, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 };
    });
    // Income has credit balances, so the year's profit is minus the net of all these balances
    const profit = -rows.reduce((s, r) => s + Number(r.net), 0);
    return { lines, profit };
  }

  /** The profit or loss a year's close would move, for the confirmation before closing its last month. */
  async yearEndPreview(organizationId: string, yearId: string) {
    const year = await this.prisma.fiscalYear.findFirst({ where: { id: yearId, organizationId }, select: { name: true, startDate: true, endDate: true } });
    if (!year) throw new NotFoundException('Financial year not found.');
    const { lines, profit } = await PeriodsService.yearEnd(this.prisma, organizationId, year);
    return { name: year.name, profit, accounts: lines.length };
  }

  /** Closes the earliest open period. Nothing dated in it can then be posted, changed or reversed. */
  async close(id: string, reason: string | undefined, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.findPeriod(tx, organizationId, id);
      if (p.status === 'closed') throw refuse(ConflictException, 'This period is already closed.', 'already_closed');
      const earlierOpen = await tx.period.findFirst({ where: { organizationId, status: 'open', startDate: { lt: p.startDate } }, select: { id: true } });
      if (earlierOpen) throw refuse(ConflictException, 'Close earlier periods first: periods close in order.', 'earlier_open');
      // Closing a year's last month closes the year: its profit moves to retained earnings first, while the month is still open
      if (p.number === p.fiscalYear._count.periods) await this.closeYear(tx, organizationId, p.fiscalYear, iso(p.endDate), ctx);
      await tx.period.update({ where: { id }, data: { status: 'closed', closedAt: new Date(), closedById: ctx.actor.userId, closeReason: reason ?? null } });
      await this.audit.record(
        { action: 'org.period.close', actorId: ctx.actor.userId, organizationId, entityType: 'period', entityId: id, after: { period: `${p.fiscalYear.name} · ${p.number}`, startDate: iso(p.startDate), endDate: iso(p.endDate), reason: reason ?? null }, req: ctx.req },
        tx,
      );
    });
  }

  /** Reopens the latest closed period, so a mistake can be corrected. Always audited with the reason. */
  async reopen(id: string, reason: string | undefined, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.findPeriod(tx, organizationId, id);
      if (p.status === 'open') throw refuse(ConflictException, 'This period is already open.', 'already_open');
      const laterClosed = await tx.period.findFirst({ where: { organizationId, status: 'closed', startDate: { gt: p.startDate } }, select: { id: true } });
      if (laterClosed) throw refuse(ConflictException, 'Reopen later periods first: periods reopen in reverse order.', 'later_closed');
      await tx.period.update({ where: { id }, data: { status: 'open', closedAt: null, closedById: null, closeReason: null } });
      // Reopening a closed year's last month reverses its closing entry, so the year can be corrected and closed again
      if (p.fiscalYear.closingEntryId) await this.reopenYear(tx, organizationId, { ...p.fiscalYear, closingEntryId: p.fiscalYear.closingEntryId }, iso(p.endDate), ctx);
      await this.audit.record(
        { action: 'org.period.reopen', actorId: ctx.actor.userId, organizationId, entityType: 'period', entityId: id, after: { period: `${p.fiscalYear.name} · ${p.number}`, startDate: iso(p.startDate), endDate: iso(p.endDate), reason: reason ?? null }, req: ctx.req },
        tx,
      );
    });
  }

  private async closeYear(tx: Tx, organizationId: string, year: { id: string; name: string; startDate: Date; endDate: Date }, lastDay: string, ctx: Ctx) {
    const { lines, profit } = await PeriodsService.yearEnd(tx, organizationId, year);
    let entry: { id: string; number: string } | null = null;
    if (lines.length) {
      const retained = await tx.account.findFirst({ where: { organizationId, systemKey: 'retained_earnings' }, select: { id: true } });
      if (!retained) throw refuse(ConflictException, 'The Retained earnings account is missing, so the year can’t close.', 'no_retained_earnings');
      if (profit) lines.push({ accountId: retained.id, debit: profit < 0 ? -profit : 0, credit: profit > 0 ? profit : 0 });
      entry = await this.journals.postSystemEntry(tx, organizationId, { date: lastDay, memo: `Year-end close ${year.name}`, lines }, ctx.actor.userId);
      await tx.fiscalYear.update({ where: { id: year.id }, data: { closingEntryId: entry.id } });
    }
    await this.audit.record({ action: 'org.fiscal_year.close', actorId: ctx.actor.userId, organizationId, entityType: 'fiscal_year', entityId: year.id, after: { name: year.name, profit, closingEntry: entry?.number ?? null }, req: ctx.req }, tx);
  }

  private async reopenYear(tx: Tx, organizationId: string, year: { id: string; name: string; closingEntryId: string }, lastDay: string, ctx: Ctx) {
    await tx.fiscalYear.update({ where: { id: year.id }, data: { closingEntryId: null } });
    const r = await this.journals.reverseInTx(tx, organizationId, year.closingEntryId, ctx.actor.userId, { date: lastDay, memo: `Year-end close of ${year.name} reversed (year reopened)` }, { system: true });
    await this.audit.record({ action: 'org.fiscal_year.reopen', actorId: ctx.actor.userId, organizationId, entityType: 'fiscal_year', entityId: year.id, after: { name: year.name, closingEntry: r.original, reversal: r.number }, req: ctx.req }, tx);
  }
}
