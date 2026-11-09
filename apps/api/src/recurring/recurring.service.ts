import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  invoiceAmounts,
  invoiceNumber,
  nextOccurrence,
  todayIn,
  type RecurringFrequency,
  type RecurringStatus,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { recurringSchema } from '@ledgernest/shared';
import type { Actor, Tenant } from '../access/types.js';
import { runInOrganization } from '../access/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req?: Request };
type Input = z.output<typeof recurringSchema>;
type Template = Pick<Input, 'reference' | 'notes' | 'placeOfSupply' | 'lines'>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const errorText = (e: unknown) => {
  const r = (e as { response?: { message?: unknown } })?.response?.message;
  return (
    typeof r === 'string' ? r : e instanceof Error ? e.message : String(e)
  ).slice(0, 500);
};

const select = {
  id: true,
  name: true,
  frequency: true,
  interval: true,
  startDate: true,
  endDate: true,
  maxCount: true,
  count: true,
  nextDate: true,
  autoIssue: true,
  status: true,
  template: true,
  lastRunAt: true,
  lastError: true,
  createdAt: true,
  contact: { select: { id: true, name: true, currency: true } },
  invoices: {
    orderBy: { issueDate: 'desc' as const },
    take: 12,
    select: {
      id: true,
      number: true,
      status: true,
      issueDate: true,
      total: true,
      fiscalYear: { select: { name: true } },
    },
  },
} as const;
type Row = Prisma.RecurringInvoiceGetPayload<{ select: typeof select }>;

/**
 * Schedules that raise invoices from a template. A run raises everything due up to today, catching up on missed
 * dates; each date is claimed before its invoice is made, so two runs never raise the same one. A date that
 * can't be raised (a closed month, an archived customer) is left for the next run, with the reason kept.
 */
@Injectable()
export class RecurringService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('Recurring');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  /** Every hour (RECURRING_RUN_MINUTES; 0 turns it off), raise whatever is due in every organisation. */
  onApplicationBootstrap() {
    const minutes = Number(
      process.env.RECURRING_RUN_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 60),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.runAll().catch((e: unknown) => this.log.error(errorText(e))),
      minutes * 60_000,
    );
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private view(r: Row) {
    const t = r.template as unknown as Template;
    return {
      id: r.id,
      name: r.name,
      contact: { id: r.contact.id, name: r.contact.name },
      currency: r.contact.currency,
      frequency: r.frequency as RecurringFrequency,
      interval: r.interval,
      startDate: iso(r.startDate),
      endDate: r.endDate && iso(r.endDate),
      maxCount: r.maxCount,
      count: r.count,
      nextDate: r.nextDate && iso(r.nextDate),
      autoIssue: r.autoIssue,
      status: r.status as RecurringStatus,
      reference: t.reference,
      notes: t.notes,
      placeOfSupply: t.placeOfSupply,
      // As a schedule takes them back: discount as a percentage
      lines: t.lines.map((l) => ({ ...l, discount: l.discount / 10_000 })),
      lastRunAt: r.lastRunAt,
      lastError: r.lastError,
      invoices: r.invoices.map((i) => ({
        id: i.id,
        number:
          i.number && i.fiscalYear
            ? invoiceNumber(i.fiscalYear.name, i.number)
            : null,
        status: i.status,
        issueDate: iso(i.issueDate),
        total: Number(i.total),
      })),
      createdAt: r.createdAt,
    };
  }

  private async find(organizationId: string, id: string) {
    const r = await this.prisma.recurringInvoice.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!r) throw new NotFoundException('Schedule not found.');
    return r;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(organizationId, id));
  }

  async list(organizationId: string) {
    const rows = await this.prisma.recurringInvoice.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { nextDate: 'asc' }, { name: 'asc' }],
      select,
    });
    return rows.map((r) => this.view(r));
  }

  /** The customer must be one, and live; the template's lines are checked when each invoice is made. */
  private async checkContact(organizationId: string, contactId: string) {
    const c = await this.prisma.contact.findFirst({
      where: { organizationId, id: contactId },
      select: { isCustomer: true, archivedAt: true },
    });
    if (!c)
      throw refuse(
        BadRequestException,
        'That contact doesn’t exist.',
        'contact_not_found',
        { field: 'contactId' },
      );
    if (!c.isCustomer)
      throw refuse(
        BadRequestException,
        'Invoices are only raised to customers.',
        'not_customer',
        { field: 'contactId' },
      );
    if (c.archivedAt)
      throw refuse(
        BadRequestException,
        'This customer is archived.',
        'contact_archived',
        { field: 'contactId' },
      );
  }

  private data(input: Input, count: number) {
    const next = nextOccurrence(input, count);
    return {
      name: input.name,
      contactId: input.contactId,
      frequency: input.frequency,
      interval: input.interval,
      startDate: asDate(input.startDate),
      endDate: input.endDate ? asDate(input.endDate) : null,
      maxCount: input.maxCount,
      autoIssue: input.autoIssue,
      template: {
        reference: input.reference,
        notes: input.notes,
        placeOfSupply: input.placeOfSupply,
        lines: input.lines,
      } as unknown as Prisma.InputJsonValue,
      nextDate: next ? asDate(next) : null,
    };
  }

  async create(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.checkContact(organizationId, input.contactId);
    const d = this.data(input, 0);
    const r = await this.prisma.recurringInvoice.create({
      data: {
        organizationId,
        ...d,
        status: d.nextDate ? 'active' : 'ended',
        createdById: ctx.actor.userId,
      },
      select: { id: true },
    });
    await this.audit.record({
      action: 'org.recurring.create',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_invoice',
      entityId: r.id,
      after: {
        name: input.name,
        frequency: input.frequency,
        interval: input.interval,
        startDate: input.startDate,
        autoIssue: input.autoIssue,
      },
      req: ctx.req,
    });
    return this.get(organizationId, r.id);
  }

  /** Changes the template or schedule. Invoices already raised stay as they are; the next date follows the new schedule. */
  async update(id: string, input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    await this.checkContact(organizationId, input.contactId);
    if (before.count > 0 && input.startDate !== iso(before.startDate))
      throw refuse(
        ConflictException,
        'Invoices have been raised from this schedule, so its start date can’t change.',
        'has_invoices',
        { field: 'startDate' },
      );
    const d = this.data(input, before.count);
    const status = !d.nextDate
      ? 'ended'
      : before.status === 'ended'
        ? 'active'
        : before.status;
    await this.prisma.recurringInvoice.update({
      where: { id },
      data: { ...d, status, lastError: null },
    });
    await this.audit.record({
      action: 'org.recurring.update',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_invoice',
      entityId: id,
      before: {
        name: before.name,
        frequency: before.frequency,
        nextDate: before.nextDate && iso(before.nextDate),
      },
      after: {
        name: input.name,
        frequency: input.frequency,
        nextDate: d.nextDate && iso(d.nextDate),
      },
      req: ctx.req,
    });
    return this.get(organizationId, id);
  }

  async setPaused(id: string, paused: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.status === 'ended')
      throw refuse(ConflictException, 'This schedule has ended.', 'ended');
    await this.prisma.recurringInvoice.update({
      where: { id },
      data: { status: paused ? 'paused' : 'active' },
    });
    await this.audit.record({
      action: paused ? 'org.recurring.pause' : 'org.recurring.resume',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_invoice',
      entityId: id,
      after: { name: r.name },
      req: ctx.req,
    });
    return this.get(organizationId, id);
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.count > 0 || r.invoices.length)
      throw refuse(
        ConflictException,
        'Invoices have been raised from this schedule. Pause it instead.',
        'has_invoices',
      );
    await this.prisma.recurringInvoice.delete({ where: { id } });
    await this.audit.record({
      action: 'org.recurring.delete',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_invoice',
      entityId: id,
      before: { name: r.name },
      req: ctx.req,
    });
  }

  /** What active schedules will raise in the next days: each date, and the amount from the template's current prices and tax. */
  async upcoming(organizationId: string, days: number) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    const today = todayIn(timeZone);
    const until = new Date(asDate(today).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = await this.prisma.recurringInvoice.findMany({
      where: {
        organizationId,
        status: 'active',
        nextDate: { not: null, lte: asDate(until) },
      },
      select,
    });
    const groupIds = [
      ...new Set(
        rows
          .flatMap((r) =>
            (r.template as unknown as Template).lines.map((l) => l.taxGroupId),
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
    const out: {
      scheduleId: string;
      name: string;
      contact: { id: string; name: string };
      currency: string | null;
      date: string;
      total: number;
      autoIssue: boolean;
      overdue: boolean;
    }[] = [];
    for (const r of rows) {
      const t = r.template as unknown as Template;
      const total = invoiceAmounts(
        t.lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPpm: l.discount,
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
      for (let n = r.count; ; n++) {
        const date = nextOccurrence(s, n);
        if (!date || date > until || out.length > 500) break;
        out.push({
          scheduleId: r.id,
          name: r.name,
          contact: { id: r.contact.id, name: r.contact.name },
          currency: r.contact.currency,
          date,
          total,
          autoIssue: r.autoIssue,
          overdue: date < today,
        });
      }
    }
    return out.sort(
      (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
    );
  }

  /** Raises everything due in one organisation, up to today (or a given day). */
  async run(organizationId: string, ctx?: Ctx, upTo?: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true, name: true },
    });
    const today = upTo ?? todayIn(org.timeZone);
    const due = await this.prisma.recurringInvoice.findMany({
      where: {
        organizationId,
        status: 'active',
        nextDate: { lte: asDate(today) },
      },
      orderBy: { nextDate: 'asc' },
      select: { id: true },
    });
    const raised: {
      scheduleId: string;
      invoiceId: string;
      date: string;
      issued: boolean;
    }[] = [];
    const failed: { scheduleId: string; date: string; reason: string }[] = [];
    for (const { id } of due) {
      // Catch up on every missed date, oldest first, stopping at the first one that can't be raised
      for (let guard = 0; guard < 400; guard++) {
        const r = await this.prisma.recurringInvoice.findFirst({
          where: { id, organizationId },
          select: {
            id: true,
            name: true,
            status: true,
            count: true,
            nextDate: true,
            startDate: true,
            endDate: true,
            maxCount: true,
            frequency: true,
            interval: true,
            autoIssue: true,
            contactId: true,
            template: true,
            createdById: true,
          },
        });
        if (
          !r ||
          r.status !== 'active' ||
          !r.nextDate ||
          iso(r.nextDate) > today
        )
          break;
        const date = iso(r.nextDate);
        const s = {
          startDate: iso(r.startDate),
          frequency: r.frequency as RecurringFrequency,
          interval: r.interval,
          endDate: r.endDate && iso(r.endDate),
          maxCount: r.maxCount,
        };
        const next = nextOccurrence(s, r.count + 1);
        // Claim the date: only one run moves the count on from what it read
        const claimed = await this.prisma.recurringInvoice.updateMany({
          where: { id, organizationId, count: r.count, status: 'active' },
          data: {
            count: r.count + 1,
            nextDate: next ? asDate(next) : null,
            status: next ? 'active' : 'ended',
            lastRunAt: new Date(),
          },
        });
        if (!claimed.count) break;
        const actor =
          ctx?.actor ?? (await this.actorFor(organizationId, r.createdById));
        const tenant =
          ctx?.tenant ??
          ({
            organizationId,
            organizationName: org.name,
            role: { type: 'built_in', key: 'owner' },
            permissions: new Set(),
            supportAccess: false,
          } as unknown as Tenant);
        const ictx = { actor, tenant, req: ctx?.req } as Parameters<
          InvoicesService['createDraft']
        >[1];
        const t = r.template as unknown as Template;
        try {
          const invoice = await runInOrganization(organizationId, async () => {
            const d = await this.invoices.createDraft(
              {
                contactId: r.contactId,
                issueDate: date,
                dueDate: null,
                reference: t.reference,
                notes: t.notes,
                placeOfSupply: t.placeOfSupply,
                receivableAccountId: null,
                rate: null,
                lines: t.lines.map((l) => ({
                  itemId: l.itemId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  taxGroupId: l.taxGroupId,
                  accountId: l.accountId,
                })),
                recurringInvoiceId: r.id,
              },
              ictx,
            );
            if (!r.autoIssue) return d;
            try {
              return await this.invoices.issue(d.id, ictx);
            } catch (e) {
              // Raised, but couldn't be issued: leave the draft to look at, and say why
              await this.prisma.recurringInvoice.update({
                where: { id },
                data: { lastError: errorText(e) },
              });
              return d;
            }
          });
          raised.push({
            scheduleId: id,
            invoiceId: invoice.id,
            date,
            issued: invoice.status === 'issued',
          });
          if (invoice.status === 'issued' || !r.autoIssue)
            await this.prisma.recurringInvoice.update({
              where: { id },
              data: { lastError: null },
            });
          await this.audit.record({
            action: 'org.recurring.raise',
            actorId: actor.userId,
            organizationId,
            entityType: 'recurring_invoice',
            entityId: id,
            after: {
              name: r.name,
              date,
              invoiceId: invoice.id,
              number: invoice.number,
              issued: invoice.status === 'issued',
            },
            req: ctx?.req,
          });
        } catch (e) {
          // Give the date back so the next run tries again
          await this.prisma.recurringInvoice.update({
            where: { id },
            data: {
              count: r.count,
              nextDate: r.nextDate,
              status: 'active',
              lastError: errorText(e),
            },
          });
          failed.push({ scheduleId: id, date, reason: errorText(e) });
          break;
        }
      }
    }
    return { raised, failed };
  }

  /** Runs every organisation with something due: what the hourly timer does. */
  async runAll() {
    const orgs = await this.prisma.recurringInvoice.findMany({
      where: { status: 'active', nextDate: { lte: new Date() } },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    for (const { organizationId } of orgs) {
      const r = await this.run(organizationId);
      if (r.raised.length || r.failed.length)
        this.log.log(
          `${organizationId}: raised ${r.raised.length}, failed ${r.failed.length}`,
        );
    }
  }

  /** Runs act as whoever made the schedule, or else the organisation's owner */
  private async actorFor(
    organizationId: string,
    userId: string | null,
  ): Promise<Actor> {
    const u =
      (userId
        ? await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true },
          })
        : null) ??
      (
        await this.prisma.membership.findFirst({
          where: { organizationId, builtInRole: 'owner' },
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { id: true, email: true } } },
        })
      )?.user;
    if (!u) throw new Error('No one to raise the invoice as.');
    return { userId: u.id, email: u.email, isSuperAdmin: false };
  }
}
