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
  billNumber,
  nextOccurrence,
  todayIn,
  type RecurringFrequency,
  type RecurringStatus,
  type recurringBillSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { runInOrganization } from '../access/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { BillsService } from '../bills/bills.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req?: Request };
type Input = z.output<typeof recurringBillSchema>;
type Template = Pick<Input, 'notes' | 'placeOfSupply' | 'lines'>;

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
  autoRecord: true,
  status: true,
  template: true,
  lastRunAt: true,
  lastError: true,
  createdAt: true,
  contact: { select: { id: true, name: true, currency: true } },
  bills: {
    orderBy: { billDate: 'desc' as const },
    take: 12,
    select: {
      id: true,
      number: true,
      status: true,
      billDate: true,
      total: true,
      fiscalYear: { select: { name: true } },
    },
  },
} as const;
type Row = Prisma.RecurringBillGetPayload<{ select: typeof select }>;

/**
 * Schedules that make bills from a vendor (rent, subscriptions), the way recurring invoices work: a run makes
 * everything due up to today, catching up on missed dates; each date is claimed before its bill is made, so two
 * runs never make the same one. With autoRecord each bill is recorded too; an approval rule may still hold it, and
 * then the draft stays with the reason. A date that can't be made is left for the next run, with the reason kept.
 */
@Injectable()
export class RecurringBillsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('RecurringBills');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bills: BillsService,
  ) {}

  /** On the same clock as recurring invoices: every RECURRING_RUN_MINUTES (60; 0 turns it off) */
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
      autoRecord: r.autoRecord,
      status: r.status as RecurringStatus,
      notes: t.notes,
      placeOfSupply: t.placeOfSupply,
      // As a schedule takes them back: discount as a percentage
      lines: t.lines.map((l) => ({ ...l, discount: l.discount / 10_000 })),
      lastRunAt: r.lastRunAt,
      lastError: r.lastError,
      bills: r.bills.map((b) => ({
        id: b.id,
        number:
          b.number && b.fiscalYear
            ? billNumber(b.fiscalYear.name, b.number)
            : null,
        status: b.status,
        billDate: iso(b.billDate),
        total: Number(b.total),
      })),
      createdAt: r.createdAt,
    };
  }

  private async find(organizationId: string, id: string) {
    const r = await this.prisma.recurringBill.findFirst({
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
    const rows = await this.prisma.recurringBill.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { nextDate: 'asc' }, { name: 'asc' }],
      select,
    });
    return rows.map((r) => this.view(r));
  }

  /** The vendor must be one, and live; the template's lines are checked when each bill is made. */
  private async checkContact(organizationId: string, contactId: string) {
    const c = await this.prisma.contact.findFirst({
      where: { organizationId, id: contactId },
      select: { isVendor: true, archivedAt: true },
    });
    if (!c)
      throw refuse(
        BadRequestException,
        'That contact doesn’t exist.',
        'contact_not_found',
        { field: 'contactId' },
      );
    if (!c.isVendor)
      throw refuse(
        BadRequestException,
        'Bills only come from vendors.',
        'not_vendor',
        { field: 'contactId' },
      );
    if (c.archivedAt)
      throw refuse(
        BadRequestException,
        'This vendor is archived.',
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
      autoRecord: input.autoRecord,
      template: {
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
    const r = await this.prisma.recurringBill.create({
      data: {
        organizationId,
        ...d,
        status: d.nextDate ? 'active' : 'ended',
        createdById: ctx.actor.userId,
      },
      select: { id: true },
    });
    await this.audit.record({
      action: 'org.recurring_bill.create',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_bill',
      entityId: r.id,
      after: {
        name: input.name,
        frequency: input.frequency,
        interval: input.interval,
        startDate: input.startDate,
        autoRecord: input.autoRecord,
      },
      req: ctx.req,
    });
    return this.get(organizationId, r.id);
  }

  /** Changes the template or schedule. Bills already made stay as they are; the next date follows the new schedule. */
  async update(id: string, input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    await this.checkContact(organizationId, input.contactId);
    if (before.count > 0 && input.startDate !== iso(before.startDate))
      throw refuse(
        ConflictException,
        'Bills have been made from this schedule, so its start date can’t change.',
        'has_bills',
        { field: 'startDate' },
      );
    const d = this.data(input, before.count);
    const status = !d.nextDate
      ? 'ended'
      : before.status === 'ended'
        ? 'active'
        : before.status;
    await this.prisma.recurringBill.update({
      where: { id },
      data: { ...d, status, lastError: null },
    });
    await this.audit.record({
      action: 'org.recurring_bill.update',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_bill',
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
    await this.prisma.recurringBill.update({
      where: { id },
      data: { status: paused ? 'paused' : 'active' },
    });
    await this.audit.record({
      action: paused ? 'org.recurring_bill.pause' : 'org.recurring_bill.resume',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_bill',
      entityId: id,
      after: { name: r.name },
      req: ctx.req,
    });
    return this.get(organizationId, id);
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.count > 0 || r.bills.length)
      throw refuse(
        ConflictException,
        'Bills have been made from this schedule. Pause it instead.',
        'has_bills',
      );
    await this.prisma.recurringBill.delete({ where: { id } });
    await this.audit.record({
      action: 'org.recurring_bill.delete',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'recurring_bill',
      entityId: id,
      before: { name: r.name },
      req: ctx.req,
    });
  }

  /** Makes everything due in one organisation, up to today (or a given day). */
  async run(organizationId: string, ctx?: Ctx, upTo?: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true, name: true },
    });
    const today = upTo ?? todayIn(org.timeZone);
    const due = await this.prisma.recurringBill.findMany({
      where: {
        organizationId,
        status: 'active',
        nextDate: { lte: asDate(today) },
      },
      orderBy: { nextDate: 'asc' },
      select: { id: true },
    });
    const made: {
      scheduleId: string;
      billId: string;
      date: string;
      recorded: boolean;
    }[] = [];
    const failed: { scheduleId: string; date: string; reason: string }[] = [];
    for (const { id } of due) {
      // Catch up on every missed date, oldest first, stopping at the first one that can't be made
      for (let guard = 0; guard < 400; guard++) {
        const r = await this.prisma.recurringBill.findFirst({
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
            autoRecord: true,
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
        const next = nextOccurrence(
          {
            startDate: iso(r.startDate),
            frequency: r.frequency as RecurringFrequency,
            interval: r.interval,
            endDate: r.endDate && iso(r.endDate),
            maxCount: r.maxCount,
          },
          r.count + 1,
        );
        // Claim the date: only one run moves the count on from what it read
        const claimed = await this.prisma.recurringBill.updateMany({
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
        const bctx = { actor, tenant, req: ctx?.req } as Parameters<
          BillsService['createDraft']
        >[1];
        const t = r.template as unknown as Template;
        try {
          const bill = await runInOrganization(organizationId, async () => {
            const d = await this.bills.createDraft(
              {
                contactId: r.contactId,
                billDate: date,
                dueDate: null,
                vendorReference: null,
                notes: t.notes,
                placeOfSupply: t.placeOfSupply,
                payableAccountId: null,
                rate: null,
                lines: t.lines.map((l) => ({
                  itemId: l.itemId,
                  description: l.description,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  taxGroupId: l.taxGroupId,
                  accountId: l.accountId,
                  costCentreId: l.costCentreId ?? null,
                })),
                recurringBillId: r.id,
              },
              bctx,
            );
            if (!r.autoRecord) return d;
            try {
              return await this.bills.record(d.id, bctx);
            } catch (e) {
              // Made, but couldn't be recorded (an approval rule, a closed month): leave the draft, and say why
              await this.prisma.recurringBill.update({
                where: { id },
                data: { lastError: errorText(e) },
              });
              return d;
            }
          });
          made.push({
            scheduleId: id,
            billId: bill.id,
            date,
            recorded: bill.status === 'open',
          });
          if (bill.status === 'open' || !r.autoRecord)
            await this.prisma.recurringBill.update({
              where: { id },
              data: { lastError: null },
            });
          await this.audit.record({
            action: 'org.recurring_bill.raise',
            actorId: actor.userId,
            organizationId,
            entityType: 'recurring_bill',
            entityId: id,
            after: {
              name: r.name,
              date,
              billId: bill.id,
              number: bill.number,
              recorded: bill.status === 'open',
            },
            req: ctx?.req,
          });
        } catch (e) {
          // Give the date back so the next run tries again
          await this.prisma.recurringBill.update({
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
    return { made, failed };
  }

  /** Runs every organisation with something due: what the timer does. */
  async runAll() {
    const orgs = await this.prisma.recurringBill.findMany({
      where: { status: 'active', nextDate: { lte: new Date() } },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    for (const { organizationId } of orgs) {
      const r = await this.run(organizationId);
      if (r.made.length || r.failed.length)
        this.log.log(
          `${organizationId}: made ${r.made.length}, failed ${r.failed.length}`,
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
    if (!u) throw new Error('No one to make the bill as.');
    return { userId: u.id, email: u.email, isSuperAdmin: false };
  }
}
