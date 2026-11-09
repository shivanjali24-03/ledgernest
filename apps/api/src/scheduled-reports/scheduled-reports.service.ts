import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  csvToRows,
  nextReportRun,
  parseCsv,
  reportPeriod,
  XLSX_TYPE,
  xlsxBytes,
  type ScheduledReportKind,
  type scheduledReportSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { membershipPermissions } from '../access/membership-permissions.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from '../reports/reports.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Input = z.output<typeof scheduledReportSchema>;
const TITLES: Record<ScheduledReportKind, string> = {
  profit_and_loss: 'Profit and loss',
  balance_sheet: 'Balance sheet',
  trial_balance: 'Trial balance',
  receivables_aging: 'Receivables aging',
  payables_aging: 'Payables aging',
};
const select = {
  id: true,
  name: true,
  report: true,
  frequency: true,
  day: true,
  format: true,
  recipients: true,
  active: true,
  nextRunAt: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
const deliverySelect = {
  id: true,
  periodFrom: true,
  periodTo: true,
  fileName: true,
  contentType: true,
  emailedTo: true,
  error: true,
  createdAt: true,
} as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Scheduled reports. Each run makes the file (kept in the organisation, to download any time) and emails it
 * to the members chosen who can still see reports, when email is set up. Due runs are picked up every
 * SCHEDULED_REPORTS_MINUTES (15; 0 turns it off).
 */
@Injectable()
export class ScheduledReportsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('ScheduledReports');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(
      process.env.SCHEDULED_REPORTS_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 15),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        ),
      minutes * 60_000,
    );
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recipients must be members of the organisation who can see reports */
  private async checkRecipients(organizationId: string, ids: string[]) {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: ids } },
      select: {
        userId: true,
        builtInRole: true,
        customRole: { select: { permissions: true } },
      },
    });
    const ok = new Set(
      members
        .filter((m) => membershipPermissions(m).has('reports.view'))
        .map((m) => m.userId),
    );
    const bad = ids.filter((i) => !ok.has(i));
    if (bad.length)
      throw new BadRequestException({
        message: 'Reports can only go to members who can see reports.',
        details: {
          reason: 'recipient_invalid',
          field: 'recipients',
          users: bad,
        },
      });
  }

  async list(organizationId: string) {
    return this.prisma.scheduledReport.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select,
    });
  }

  private async find(organizationId: string, id: string) {
    const s = await this.prisma.scheduledReport.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!s) throw new NotFoundException('Scheduled report not found.');
    return s;
  }

  async create(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.checkRecipients(organizationId, input.recipients);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.scheduledReport.create({
        data: {
          organizationId,
          ...input,
          recipients: [...new Set(input.recipients)],
          nextRunAt: nextReportRun(new Date(), input.frequency, input.day),
          createdById: ctx.actor.userId,
        },
        select,
      });
      await this.audit.record(
        {
          action: 'org.scheduled_report.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'scheduled_report',
          entityId: s.id,
          after: {
            name: s.name,
            report: s.report,
            frequency: s.frequency,
            day: s.day,
            recipients: s.recipients.length,
          },
          req: ctx.req,
        },
        tx,
      );
      return s;
    });
  }

  async update(id: string, input: Partial<Input>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    if (input.recipients)
      await this.checkRecipients(organizationId, input.recipients);
    const merged = { ...before, ...input };
    if (merged.frequency === 'weekly' && merged.day > 7)
      throw new BadRequestException({
        message: 'Choose a day of the week.',
        details: { field: 'day' },
      });
    const timing =
      input.frequency !== undefined ||
      input.day !== undefined ||
      (input.active === true && !before.active);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.scheduledReport.update({
        where: { id },
        data: {
          ...input,
          ...(input.recipients && {
            recipients: [...new Set(input.recipients)],
          }),
          ...(timing && {
            nextRunAt: nextReportRun(
              new Date(),
              merged.frequency as Input['frequency'],
              merged.day,
            ),
          }),
        },
        select,
      });
      await this.audit.record(
        {
          action: 'org.scheduled_report.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'scheduled_report',
          entityId: id,
          before: {
            name: before.name,
            frequency: before.frequency,
            day: before.day,
            active: before.active,
          },
          after: {
            name: s.name,
            frequency: s.frequency,
            day: s.day,
            active: s.active,
          },
          req: ctx.req,
        },
        tx,
      );
      return s;
    });
  }

  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const s = await this.find(organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.scheduledReport.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.scheduled_report.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'scheduled_report',
          entityId: id,
          before: { name: s.name, report: s.report },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  async deliveries(organizationId: string, id: string) {
    await this.find(organizationId, id);
    return this.prisma.reportDelivery.findMany({
      where: { organizationId, scheduleId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: deliverySelect,
    });
  }

  async file(organizationId: string, deliveryId: string) {
    const d = await this.prisma.reportDelivery.findFirst({
      where: { organizationId, id: deliveryId },
      select: { fileName: true, contentType: true, data: true },
    });
    if (!d) throw new NotFoundException('Report not found.');
    return d;
  }

  /** Everything due, in every organisation; each claimed first (its next run moved on) so it runs once */
  async runDue(now = new Date()) {
    const due = await this.prisma.scheduledReport.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      take: 100,
      select: { id: true, nextRunAt: true, frequency: true, day: true },
    });
    for (const s of due) {
      const claimed = await this.prisma.scheduledReport.updateMany({
        where: { id: s.id, nextRunAt: s.nextRunAt },
        data: {
          nextRunAt: nextReportRun(
            now,
            s.frequency as Input['frequency'],
            s.day,
          ),
          lastRunAt: now,
        },
      });
      if (claimed.count)
        await this.deliver(s.id, iso(now)).catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        );
    }
  }

  /** Runs it now, for the period just ended, as if it were due */
  async runNow(id: string, ctx: Ctx) {
    await this.find(ctx.tenant.organizationId, id);
    await this.prisma.scheduledReport.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
    const deliveryId = await this.deliver(id, iso(new Date()));
    return this.prisma.reportDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: deliverySelect,
    });
  }

  /** Makes the file, keeps it, and emails it to whichever recipients can still see reports */
  private async deliver(id: string, runDay: string) {
    const s = await this.prisma.scheduledReport.findUniqueOrThrow({
      where: { id },
      select: {
        ...select,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    const organizationId = s.organizationId;
    const { from, to } = reportPeriod(
      runDay,
      s.frequency as Input['frequency'],
    );
    const kind = s.report as ScheduledReportKind;
    const minor = await this.reports.decimals(organizationId);
    const csv =
      kind === 'profit_and_loss'
        ? this.reports.pnlCsv(
            await this.reports.profitAndLoss(organizationId, from, to, 'none'),
            minor,
          )
        : kind === 'balance_sheet'
          ? this.reports.bsCsv(
              await this.reports.balanceSheet(organizationId, to),
              minor,
            )
          : kind === 'trial_balance'
            ? this.reports.trialBalanceCsv(
                await this.reports.trialBalance(organizationId, to),
                minor,
              )
            : this.reports.agingCsv(
                await this.reports.aging(
                  organizationId,
                  kind === 'receivables_aging' ? 'receivables' : 'payables',
                  to,
                ),
              );
    const period =
      kind === 'profit_and_loss' ? `${from} to ${to}` : `as of ${to}`;
    const base = `${TITLES[kind].toLowerCase().replace(/ /g, '-')}-${kind === 'profit_and_loss' ? `${from}-${to}` : to}`;
    const file =
      s.format === 'xlsx'
        ? {
            fileName: `${base}.xlsx`,
            contentType: XLSX_TYPE,
            data: Buffer.from(
              xlsxBytes([
                { name: TITLES[kind], rows: csvToRows(csv, parseCsv) },
              ]),
            ),
          }
        : {
            fileName: `${base}.csv`,
            contentType: 'text/csv; charset=utf-8',
            data: Buffer.from(csv, 'utf8'),
          };
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: s.recipients } },
      select: {
        builtInRole: true,
        customRole: { select: { permissions: true } },
        user: { select: { email: true, status: true } },
      },
    });
    const to_ = members
      .filter(
        (m) =>
          m.user.status === 'ACTIVE' &&
          membershipPermissions(m).has('reports.view'),
      )
      .map((m) => m.user.email);
    const sent =
      this.mail.configured && to_.length
        ? await this.mail.send({
            to: to_,
            subject: `${s.name}: ${TITLES[kind]} ${period} · ${s.organization.name}`,
            text: `${TITLES[kind]} for ${s.organization.name}, ${period}, is attached.\n\nSent by LedgerNest because you're on the list for “${s.name}”. It's also kept under Reports → Scheduled.`,
            attachments: [
              {
                filename: file.fileName,
                content: file.data,
                contentType: file.contentType,
              },
            ],
          })
        : false;
    const d = await this.prisma.reportDelivery.create({
      data: {
        organizationId,
        scheduleId: id,
        periodFrom: new Date(`${from}T00:00:00Z`),
        periodTo: new Date(`${to}T00:00:00Z`),
        ...file,
        emailedTo: sent ? to_ : [],
        error:
          this.mail.configured && to_.length && !sent
            ? 'The email couldn’t be sent.'
            : null,
      },
      select: { id: true },
    });
    // Each schedule keeps its latest REPORT_RUNS_KEPT (24) runs: older files go
    const keep = Number(process.env.REPORT_RUNS_KEPT ?? 24);
    const old = await this.prisma.reportDelivery.findMany({
      where: { organizationId, scheduleId: id },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (old.length)
      await this.prisma.reportDelivery.deleteMany({
        where: { id: { in: old.map((o) => o.id) } },
      });
    return d.id;
  }
}
