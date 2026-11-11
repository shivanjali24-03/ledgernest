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
  INTEREST_MIN_CHARGE,
  splitInterest,
  todayIn,
  type InterestWaiverInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { runInOrganization } from '../access/tenant-context.js';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { AuditService } from '../audit/audit.service.js';
import { InterestService } from '../interest/interest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req?: Request };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const refuse = (
  E: typeof BadRequestException | typeof ConflictException,
  message: string,
  reason: string,
  extra: object = {},
) => new E({ message, details: { reason, ...extra } });

/**
 * Charging interest on late payment: what's accrued on an invoice, less what's been invoiced for it already and
 * what's been waived, is raised as a draft invoice to the customer. GST is charged on it at the rates of the supply
 * it's on, split by taxable value (CGST Act s.15(2)(d)), and it's booked to Interest on late payment. An owner can
 * waive interest with a reason. Optionally, on the 1st of each month, drafts are raised for every invoice with
 * interest due, for someone to look over and issue.
 */
@Injectable()
export class InterestChargesService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(InterestChargesService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly interest: InterestService,
    private readonly invoices: InvoicesService,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(
      process.env.INTEREST_RUN_MINUTES ??
        (process.env.NODE_ENV === 'test' ? 0 : 60),
    );
    if (!minutes) return;
    this.timer = setInterval(
      () =>
        void this.runMonthly().catch((e: unknown) =>
          this.log.error(e instanceof Error ? e.message : String(e)),
        ),
      minutes * 60_000,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Interest on one invoice as of a day: accrued, already invoiced, waived, and what's left to charge */
  async status(organizationId: string, invoiceId: string, asOf: string) {
    const [accrued, charges, waivers] = await Promise.all([
      this.interest.forInvoices(organizationId, { ids: [invoiceId] }, asOf),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          interestOnInvoiceId: invoiceId,
          status: { not: 'void' },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          issueDate: true,
          subtotal: true,
          total: true,
          number: true,
          fullNumber: true,
        },
      }),
      this.prisma.interestWaiver.findMany({
        where: { organizationId, invoiceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          amount: true,
          reason: true,
          date: true,
          createdAt: true,
        },
      }),
    ]);
    const a = accrued.get(invoiceId)?.accrued ?? 0;
    const charged = charges.reduce((s, c) => s + Number(c.subtotal), 0);
    const waived = waivers.reduce((s, w) => s + Number(w.amount), 0);
    return {
      asOf,
      accrued: a,
      charged,
      waived,
      chargeable: Math.max(0, a - charged - waived),
      charges: charges.map((c) => ({
        id: c.id,
        number: c.status === 'draft' ? null : c.fullNumber,
        status: c.status as 'draft' | 'issued',
        date: iso(c.issueDate),
        interest: Number(c.subtotal),
        total: Number(c.total),
      })),
      waivers: waivers.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        reason: w.reason,
        date: iso(w.date),
      })),
    };
  }

  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return todayIn(timeZone);
  }

  /** Raises a draft invoice for the interest left to charge on one invoice, to a day (default today) */
  async raise(invoiceId: string, asOfIn: string | undefined, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const asOf = asOfIn ?? (await this.today(organizationId));
    const source = await this.prisma.invoice.findFirst({
      where: { organizationId, id: invoiceId },
      select: {
        id: true,
        status: true,
        contactId: true,
        placeOfSupply: true,
        receivableAccountId: true,
        dueDate: true,
        fullNumber: true,
        interestRateBp: true,
        interestMethod: true,
        lines: { select: { amount: true, taxGroupId: true } },
      },
    });
    if (!source) throw new NotFoundException('Invoice not found.');
    if (source.status !== 'issued' || !source.interestRateBp)
      throw refuse(
        ConflictException,
        'Only an issued invoice with interest terms can be charged interest.',
        'no_interest_terms',
      );
    const s = await this.status(organizationId, invoiceId, asOf);
    if (s.chargeable < INTEREST_MIN_CHARGE)
      throw refuse(
        ConflictException,
        'There’s no interest left to charge on this invoice.',
        'nothing_to_charge',
        { accrued: s.accrued, charged: s.charged, waived: s.waived },
      );
    const accountId = await this.prisma.$transaction((tx) =>
      ensureFxAccount(tx, organizationId, 'interest_income'),
    );
    const rate = `${source.interestRateBp / 100}% a year`;
    const label = source.fullNumber ?? 'the invoice';
    const parts = splitInterest(
      s.chargeable,
      source.lines.map((l) => ({ key: l.taxGroupId, value: Number(l.amount) })),
    );
    const draft = await this.invoices.createDraft(
      {
        contactId: source.contactId,
        issueDate: asOf,
        dueDate: asOf,
        reference: label,
        notes: `Interest at ${rate} on the late payment of invoice ${label}, due ${iso(source.dueDate)}, to ${asOf}.`,
        placeOfSupply: source.placeOfSupply,
        receivableAccountId: source.receivableAccountId,
        rate: null,
        interestRateBp: 0,
        interestOnInvoiceId: invoiceId,
        lines: parts.map((p) => ({
          itemId: null,
          description: `Interest on late payment of ${label}`,
          quantity: '1',
          unitPrice: p.amount,
          discount: 0,
          taxGroupId: p.key,
          accountId,
        })),
      },
      ctx as Parameters<InvoicesService['createDraft']>[1],
      // Another raise at the same moment mustn't charge the same interest twice
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'interest:' + invoiceId}))`;
        const total = await tx.invoice.aggregate({
          where: {
            organizationId,
            interestOnInvoiceId: invoiceId,
            status: { not: 'void' },
          },
          _sum: { subtotal: true },
        });
        if (Number(total._sum.subtotal ?? 0) > s.accrued - s.waived)
          throw refuse(
            ConflictException,
            'This interest has just been charged.',
            'already_charged',
          );
      },
    );
    await this.audit.record({
      action: 'org.invoice.interest_raise',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'invoice',
      entityId: invoiceId,
      after: { draftId: draft.id, amount: s.chargeable, asOf },
      req: ctx.req,
    });
    return draft;
  }

  /** Lets the customer off interest on one invoice: an amount (default everything chargeable now), and why */
  async waive(invoiceId: string, input: InterestWaiverInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const asOf = await this.today(organizationId);
    const s = await this.status(organizationId, invoiceId, asOf);
    const amount = input.amount ?? s.chargeable;
    if (amount < 1 || amount > s.chargeable)
      throw refuse(
        BadRequestException,
        'Waive no more than the interest left to charge.',
        'waive_too_much',
        { chargeable: s.chargeable, field: 'amount' },
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.interestWaiver.create({
        data: {
          organizationId,
          invoiceId,
          amount: BigInt(amount),
          reason: input.reason,
          date: asDate(asOf),
          createdById: ctx.actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'org.invoice.interest_waive',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
          entityId: invoiceId,
          after: { amount, reason: input.reason },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.status(organizationId, invoiceId, asOf);
  }

  /** Drafts for every invoice with interest left to charge; returns how many, and for what */
  async raiseAll(organizationId: string, asOf: string, ctx: Ctx) {
    const due = await this.interest.forInvoices(organizationId, {}, asOf);
    const raised: { invoiceId: string; draftId: string; amount: number }[] = [];
    for (const [invoiceId, i] of due) {
      if (i.accrued < INTEREST_MIN_CHARGE) continue;
      const s = await this.status(organizationId, invoiceId, asOf);
      if (s.chargeable < INTEREST_MIN_CHARGE) continue;
      const d = await this.raise(invoiceId, asOf, ctx);
      raised.push({ invoiceId, draftId: d.id, amount: s.chargeable });
    }
    return { asOf, raised };
  }

  /** On or after the 1st of each month, once: drafts for every organisation that asked for it */
  async runMonthly(now = new Date()) {
    const orgs = await this.prisma.organization.findMany({
      where: { interestAutoRaise: true, status: 'ACTIVE' },
      select: { id: true, name: true, timeZone: true, interestRaisedFor: true },
    });
    let raised = 0;
    for (const o of orgs) {
      const today = todayIn(o.timeZone, now);
      const month = today.slice(0, 7);
      if (o.interestRaisedFor === month) continue;
      // Claim the month first, so two servers don't both run it
      const claimed = await this.prisma.organization.updateMany({
        where: { id: o.id, interestRaisedFor: o.interestRaisedFor },
        data: { interestRaisedFor: month },
      });
      if (!claimed.count) continue;
      const owner = await this.prisma.membership.findFirst({
        where: { organizationId: o.id, builtInRole: 'owner' },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { id: true, email: true } } },
      });
      if (!owner) continue;
      const ctx: Ctx = {
        actor: {
          userId: owner.user.id,
          email: owner.user.email,
          isSuperAdmin: false,
        } as Actor,
        tenant: {
          organizationId: o.id,
          organizationName: o.name,
          role: { type: 'built_in', key: 'owner' },
          permissions: new Set(),
          supportAccess: false,
        } as unknown as Tenant,
      };
      // Interest to the last day of the month just ended
      const end = new Date(`${month}-01T00:00:00Z`);
      end.setUTCDate(0);
      const r = await runInOrganization(o.id, () =>
        this.raiseAll(o.id, iso(end), ctx),
      );
      raised += r.raised.length;
    }
    return raised;
  }
}
