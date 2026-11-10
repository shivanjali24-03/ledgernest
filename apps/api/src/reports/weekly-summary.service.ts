import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { BUILT_IN_ROLES, currencyDigits, todayIn } from '@ledgernest/shared';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';

const ATTENTION: Record<string, (n: number, amount: string) => string> = {
  overdue_invoices: (n, a) => `${n} overdue invoice${n === 1 ? '' : 's'}, ${a}`,
  overdue_bills: (n, a) => `${n} overdue bill${n === 1 ? '' : 's'}, ${a}`,
  unreconciled: (n) => `${n} bank line${n === 1 ? '' : 's'} to reconcile`,
  recurring_due: (n) => `${n} recurring invoice${n === 1 ? '' : 's'} due`,
  open_periods: (n) => `${n} past month${n === 1 ? '' : 's'} still open`,
  draft_entries: (n) => `${n} draft entr${n === 1 ? 'y' : 'ies'} not posted`,
  approvals_waiting: (n) => `${n} waiting for approval`,
  low_stock: (n) => `${n} item${n === 1 ? '' : 's'} low on stock`,
  quotes_expiring: (n) => `${n} quote${n === 1 ? '' : 's'} expiring this week`,
  recurring_bills_due: (n) => `${n} recurring bill${n === 1 ? '' : 's'} due`,
};

/**
 * The weekly summary: every Monday (in the organisation's time zone), Owners and Admins of organisations that
 * turned it on get the dashboard's figures and what needs attention by email. Checked every
 * WEEKLY_SUMMARY_MINUTES (60; 0 turns it off); sent once per Monday.
 */
@Injectable()
export class WeeklySummaryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger('WeeklySummary');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly dashboards: DashboardService,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(
      process.env.WEEKLY_SUMMARY_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 60),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        ),
      minutes * 60_000,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends the summaries due now; returns how many organisations got one */
  async runDue(now = new Date()) {
    if (!this.mail.configured) return 0;
    const orgs = await this.prisma.organization.findMany({
      where: { weeklySummary: true, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        timeZone: true,
        weeklySummarySentOn: true,
      },
    });
    let sent = 0;
    for (const org of orgs) {
      const today = todayIn(org.timeZone, now);
      const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
      if (
        !monday ||
        org.weeklySummarySentOn?.toISOString().slice(0, 10) === today
      )
        continue;
      try {
        if (await this.send(org.id, org.name)) sent++;
        await this.prisma.organization.update({
          where: { id: org.id },
          data: { weeklySummarySentOn: new Date(`${today}T00:00:00Z`) },
        });
      } catch (e) {
        this.log.warn(
          `Weekly summary for ${org.id} not sent: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return sent;
  }

  private async send(organizationId: string, name: string) {
    const members = await this.prisma.membership.findMany({
      where: {
        organizationId,
        builtInRole: { in: ['owner', 'admin'] },
        user: { status: 'ACTIVE' },
      },
      select: { user: { select: { email: true } } },
    });
    const to = members.map((m) => m.user.email);
    if (!to.length) return false;
    const d = await this.dashboards.dashboard(
      organizationId,
      new Set(BUILT_IN_ROLES.owner.permissions) as never,
    );
    const digits = currencyDigits(d.baseCurrency);
    const money = (minor: number) =>
      `${d.baseCurrency} ${(minor / 10 ** digits).toFixed(digits)}`;
    const k = d.kpis;
    const attention = d.alerts.map(
      (a) =>
        `• ${(ATTENTION[a.kind] ?? ((n: number) => `${n} × ${a.kind}`))(a.count, a.amount === undefined ? '' : money(a.amount))}`,
    );
    const text = [
      `${name}: your week, as of ${d.asOf}`,
      [
        `Cash and bank: ${money(k.cash.value)}`,
        `Owed to you: ${money(k.receivables.value)}`,
        `You owe: ${money(k.payables.value)}`,
        `Profit this financial year: ${money(k.profit.value)}`,
      ].join('\n'),
      attention.length
        ? `Needs attention:\n${attention.join('\n')}`
        : 'Nothing needs attention. Have a good week.',
      'Sent by LedgerNest because weekly summaries are on in Settings. Owners and Admins can turn them off there.',
    ].join('\n\n');
    return this.mail.send({
      to,
      subject: `${name}: weekly summary, ${d.asOf}`,
      text,
    });
  }
}
