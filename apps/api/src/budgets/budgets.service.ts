import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  compareCodes,
  favourable,
  PNL_SECTIONS,
  pnlSectionOf,
  yearMonths,
  type budgetCreateSchema,
  type PnlSection,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { checkCostCentres } from '../cost-centres/check.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Budgets: what each income and expense account should come to in each month of a financial year. They start
 * from last year's actuals (up or down by a percentage), another budget, or nothing, and are then edited.
 * Budget against actual reads like the profit and loss, with each variance signed so that positive is good.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Each income and expense account's actual amount per month over some months, the way it reads (income and expenses both positive) */
  /** costCentreId: only that cost centre's lines (a budget for one cost centre or project) */
  private async actuals(
    organizationId: string,
    from: string,
    to: string,
    costCentreId: string | null = null,
  ) {
    const rows = await this.prisma.$queryRaw<
      { account_id: string; month: string; type: string; net: bigint }[]
    >`
      SELECT l.account_id, to_char(e.date, 'YYYY-MM') AS month, a.type, sum(l.debit - l.credit)::bigint AS net
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND a.type IN ('income', 'expense')
        AND e.date BETWEEN ${asDate(from)}::date AND ${asDate(to)}::date
        AND e.id NOT IN (SELECT closing_entry_id FROM fiscal_years WHERE organization_id = ${organizationId}::uuid AND closing_entry_id IS NOT NULL)
        AND (${costCentreId}::uuid IS NULL OR l.cost_centre_id = ${costCentreId}::uuid)
      GROUP BY 1, 2, 3`;
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = out.get(r.account_id) ?? new Map<string, number>();
      m.set(r.month, (r.type === 'income' ? -1 : 1) * Number(r.net));
      out.set(r.account_id, m);
    }
    return out;
  }

  private async find(organizationId: string, id: string) {
    const b = await this.prisma.budget.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        fiscalYear: {
          select: { id: true, name: true, startDate: true, endDate: true },
        },
        lines: { select: { accountId: true, month: true, amount: true } },
        costCentre: { select: { id: true, code: true, name: true } },
      },
    });
    if (!b) throw new NotFoundException('Budget not found.');
    return b;
  }

  async list(organizationId: string) {
    const rows = await this.prisma.budget.findMany({
      where: { organizationId },
      orderBy: [{ fiscalYear: { startDate: 'desc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        updatedAt: true,
        fiscalYear: { select: { id: true, name: true } },
        costCentre: { select: { id: true, code: true, name: true } },
        lines: {
          select: { amount: true, account: { select: { type: true } } },
        },
      },
    });
    return rows.map((b) => {
      const income = b.lines
        .filter((l) => l.account.type === 'income')
        .reduce((s, l) => s + Number(l.amount), 0);
      const expenses = b.lines
        .filter((l) => l.account.type === 'expense')
        .reduce((s, l) => s + Number(l.amount), 0);
      return {
        id: b.id,
        name: b.name,
        fiscalYear: b.fiscalYear,
        costCentre: b.costCentre,
        updatedAt: b.updatedAt,
        income,
        expenses,
        profit: income - expenses,
      };
    });
  }

  /** The budget as a grid: an account per row (income and expense, every one that's active or has a figure), twelve months across */
  async get(organizationId: string, id: string) {
    const b = await this.find(organizationId, id);
    const months = yearMonths(iso(b.fiscalYear.startDate));
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, type: { in: ['income', 'expense'] } },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        archivedAt: true,
        parentId: true,
      },
    });
    const parents = new Set(accounts.map((a) => a.parentId).filter(Boolean));
    const amounts = new Map<string, number[]>();
    for (const l of b.lines) {
      const arr = amounts.get(l.accountId) ?? months.map(() => 0);
      arr[months.indexOf(iso(l.month).slice(0, 7))] = Number(l.amount);
      amounts.set(l.accountId, arr);
    }
    const rows = accounts
      .filter((a) => !parents.has(a.id) && (!a.archivedAt || amounts.has(a.id)))
      .sort((x, y) => compareCodes(x.code, y.code))
      .map((a) => {
        const am = amounts.get(a.id) ?? months.map(() => 0);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type as 'income' | 'expense',
          section: pnlSectionOf(a.type, a.subtype)!,
          amounts: am,
          total: am.reduce((s, v) => s + v, 0),
        };
      });
    return {
      id: b.id,
      name: b.name,
      costCentre: b.costCentre,
      fiscalYear: {
        id: b.fiscalYear.id,
        name: b.fiscalYear.name,
        startDate: iso(b.fiscalYear.startDate),
        endDate: iso(b.fiscalYear.endDate),
      },
      months,
      rows,
      updatedAt: b.updatedAt,
    };
  }

  async create(input: z.output<typeof budgetCreateSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const year = await this.prisma.fiscalYear.findFirst({
      where: { organizationId, id: input.fiscalYearId },
      select: { id: true, name: true, startDate: true },
    });
    if (!year)
      throw refuse(
        BadRequestException,
        'That financial year doesn’t exist.',
        'year_not_found',
        { field: 'fiscalYearId' },
      );
    if (
      await this.prisma.budget.findFirst({
        where: { organizationId, fiscalYearId: year.id, name: input.name },
        select: { id: true },
      })
    )
      throw refuse(
        ConflictException,
        'This year already has a budget with that name.',
        'name_taken',
        { field: 'name' },
      );
    const months = yearMonths(iso(year.startDate));
    const factor = 1 + input.adjustPercent / 100;
    let seed = new Map<string, number[]>();
    if (input.startFrom === 'actuals') {
      // Last year's months line up with this year's, one for one
      const lastStart = new Date(
        Date.UTC(
          year.startDate.getUTCFullYear() - 1,
          year.startDate.getUTCMonth(),
          1,
        ),
      )
        .toISOString()
        .slice(0, 10);
      const lastMonths = yearMonths(lastStart);
      const lastEnd = new Date(
        Date.parse(`${iso(year.startDate)}T00:00:00Z`) - 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const actuals = await this.actuals(
        organizationId,
        lastStart,
        lastEnd,
        input.costCentreId,
      );
      seed = new Map(
        [...actuals].map(([acc, m]) => [
          acc,
          lastMonths.map((mm) => Math.round((m.get(mm) ?? 0) * factor)),
        ]),
      );
    } else if (input.startFrom === 'budget') {
      const other = input.budgetId
        ? await this.find(organizationId, input.budgetId)
        : null;
      if (!other)
        throw refuse(
          BadRequestException,
          'Choose the budget to start from.',
          'budget_not_found',
          { field: 'budgetId' },
        );
      const otherMonths = yearMonths(iso(other.fiscalYear.startDate));
      for (const l of other.lines) {
        const arr = seed.get(l.accountId) ?? months.map(() => 0);
        arr[otherMonths.indexOf(iso(l.month).slice(0, 7))] = Math.round(
          Number(l.amount) * factor,
        );
        seed.set(l.accountId, arr);
      }
    }
    const b = await this.prisma.$transaction(async (tx) => {
      await checkCostCentres(tx, organizationId, [
        { costCentreId: input.costCentreId },
      ]);
      const created = await tx.budget.create({
        data: {
          organizationId,
          fiscalYearId: year.id,
          name: input.name,
          costCentreId: input.costCentreId,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      const data = [...seed].flatMap(([accountId, am]) =>
        am
          .map((amount, k) => ({
            organizationId,
            budgetId: created.id,
            accountId,
            month: asDate(`${months[k]}-01`),
            amount: BigInt(amount),
          }))
          .filter((l) => l.amount !== 0n),
      );
      if (data.length) await tx.budgetLine.createMany({ data });
      await this.audit.record(
        {
          action: 'org.budget.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'budget',
          entityId: created.id,
          after: {
            name: input.name,
            year: year.name,
            startFrom: input.startFrom,
            adjustPercent: input.adjustPercent,
          },
          req: ctx.req,
        },
        tx,
      );
      return created;
    });
    return this.get(organizationId, b.id);
  }

  /** Replaces the amounts for the accounts given; the others stay as they are */
  async setLines(
    id: string,
    lines: { accountId: string; amounts: number[] }[],
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const b = await this.find(organizationId, id);
    const months = yearMonths(iso(b.fiscalYear.startDate));
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, type: true },
    });
    if (
      accounts.length !== ids.length ||
      accounts.some((a) => a.type !== 'income' && a.type !== 'expense')
    )
      throw refuse(
        BadRequestException,
        'Budgets are for income and expense accounts.',
        'not_pnl_account',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetLine.deleteMany({
        where: { organizationId, budgetId: id, accountId: { in: ids } },
      });
      const data = lines.flatMap((l) =>
        l.amounts
          .map((amount, k) => ({
            organizationId,
            budgetId: id,
            accountId: l.accountId,
            month: asDate(`${months[k]}-01`),
            amount: BigInt(amount),
          }))
          .filter((x) => x.amount !== 0n),
      );
      if (data.length) await tx.budgetLine.createMany({ data });
      await tx.budget.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.budget.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'budget',
          entityId: id,
          after: { name: b.name, accounts: ids.length },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  async rename(id: string, name: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const b = await this.find(organizationId, id);
    if (
      await this.prisma.budget.findFirst({
        where: {
          organizationId,
          fiscalYearId: b.fiscalYear.id,
          name,
          id: { not: id },
        },
        select: { id: true },
      })
    )
      throw refuse(
        ConflictException,
        'This year already has a budget with that name.',
        'name_taken',
        { field: 'name' },
      );
    await this.prisma.budget.update({ where: { id }, data: { name } });
    await this.audit.record({
      action: 'org.budget.update',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'budget',
      entityId: id,
      before: { name: b.name },
      after: { name },
      req: ctx.req,
    });
    return this.get(organizationId, id);
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const b = await this.find(organizationId, id);
    await this.prisma.budget.delete({ where: { id } });
    await this.audit.record({
      action: 'org.budget.delete',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'budget',
      entityId: id,
      before: { name: b.name, year: b.fiscalYear.name },
      req: ctx.req,
    });
  }

  /**
   * Budget against actual for the year so far (or up to a month): each account's budget and actual, the
   * variance (positive when better than planned) and its percentage, by profit-and-loss section, with net profit.
   */
  async comparison(organizationId: string, id: string, upTo?: string) {
    const b = await this.get(organizationId, id);
    const last = upTo ? upTo.slice(0, 7) : b.months[11]!;
    const count = Math.max(0, b.months.filter((m) => m <= last).length);
    const to = upTo ?? b.fiscalYear.endDate;
    const actual = await this.actuals(
      organizationId,
      b.fiscalYear.startDate,
      to < b.fiscalYear.endDate ? to : b.fiscalYear.endDate,
      b.costCentre?.id ?? null,
    );
    // Accounts with actuals but no budget row (a parent posted to directly, an archived one) still show
    const known = new Set(b.rows.map((r) => r.accountId));
    const extra = [...actual.keys()].filter((a) => !known.has(a));
    const extraAccounts = extra.length
      ? await this.prisma.account.findMany({
          where: { organizationId, id: { in: extra } },
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            subtype: true,
          },
        })
      : [];
    const rows = [
      ...b.rows.map((r) => ({ ...r })),
      ...extraAccounts.map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type as 'income' | 'expense',
        section: pnlSectionOf(a.type, a.subtype)!,
        amounts: b.months.map(() => 0),
        total: 0,
      })),
    ]
      .map((r) => {
        const budget = r.amounts.slice(0, count).reduce((s, v) => s + v, 0);
        const act = b.months
          .slice(0, count)
          .reduce((s, m) => s + (actual.get(r.accountId)?.get(m) ?? 0), 0);
        const variance = favourable(r.type, budget, act);
        return {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          type: r.type,
          section: r.section,
          budget,
          actual: act,
          variance,
          percent: budget
            ? Math.round((variance / Math.abs(budget)) * 1000) / 10
            : null,
        };
      })
      .filter((r) => r.budget || r.actual)
      .sort((x, y) => compareCodes(x.code, y.code));
    const sum = (sec: PnlSection, k: 'budget' | 'actual') =>
      rows.filter((r) => r.section === sec).reduce((s, r) => s + r[k], 0);
    const sections = PNL_SECTIONS.map((sec) => {
      const budget = sum(sec, 'budget');
      const act = sum(sec, 'actual');
      const type =
        sec === 'revenue' || sec === 'otherIncome' ? 'income' : 'expense';
      return {
        section: sec,
        rows: rows.filter((r) => r.section === sec),
        budget,
        actual: act,
        variance: favourable(type, budget, act),
      };
    });
    const net = (k: 'budget' | 'actual') =>
      sections.reduce(
        (s, sec) =>
          s +
          (sec.section === 'revenue' || sec.section === 'otherIncome'
            ? 1
            : -1) *
            sec[k],
        0,
      );
    return {
      id: b.id,
      name: b.name,
      fiscalYear: b.fiscalYear,
      upTo: to,
      months: count,
      sections,
      netProfit: {
        budget: net('budget'),
        actual: net('actual'),
        variance: net('actual') - net('budget'),
      },
    };
  }
}
