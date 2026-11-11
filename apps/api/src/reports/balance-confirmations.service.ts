import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  currencyDigits,
  fiscalYearOf,
  fiscalYearSpan,
  type BalanceConfirmationRequest,
  type ConfirmationSide,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { SHARE_TOKEN } from '../invoices/invoice-share.service.js';
import { MailService } from '../mail/mail.service.js';
import { organizationSender } from '../common/reply-to.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StatementsService } from './statements.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const plural = (side: ConfirmationSide) =>
  side === 'receivable' ? ('receivables' as const) : ('payables' as const);

/**
 * Balance confirmations for the audit: each customer or vendor gets a link showing their balance with us on the
 * day, to agree or dispute. Asked again for the same day, the same request is reused (and sent again).
 */
@Injectable()
export class BalanceConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private link(token: string) {
    return `${this.config.get('WEB_APP_URL', { infer: true })}/b/${token}`;
  }

  private money(minor: number, currency: string) {
    const d = currencyDigits(currency);
    return `${currency} ${(minor / 10 ** d).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  }

  /** What our books say the contact's balance was on the day, in their currency */
  private async balanceOn(
    organizationId: string,
    contact: { id: string; currency: string | null },
    side: ConfirmationSide,
    asOf: string,
    baseCurrency: string,
  ) {
    const s = await this.statements.statement(
      organizationId,
      contact.id,
      plural(side),
      asOf,
      asOf,
    );
    const currency = contact.currency ?? baseCurrency;
    return {
      currency,
      balance: s.sections.find((x) => x.currency === currency)?.closing ?? 0,
    };
  }

  async request(
    input: Required<Pick<BalanceConfirmationRequest, 'asOf' | 'side'>> & {
      contactIds?: string[];
      send: boolean;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, legalName: true, baseCurrency: true },
    });
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId,
        ...(input.side === 'receivable'
          ? { isCustomer: true }
          : { isVendor: true }),
        ...(input.contactIds
          ? { id: { in: input.contactIds } }
          : { archivedAt: null }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        legalName: true,
        email: true,
        currency: true,
      },
    });
    const created: { contactId: string; name: string }[] = [];
    const emailed: string[] = [];
    const skipped: { contactId: string; name: string; reason: string }[] = [];
    const mailOn = input.send && this.mail.configured;
    for (const c of contacts) {
      const { currency, balance } = await this.balanceOn(
        organizationId,
        c,
        input.side,
        input.asOf,
        org.baseCurrency,
      );
      // Everyone asked by name is asked; otherwise only those with something to confirm
      if (!input.contactIds && balance === 0) continue;
      const key = {
        organizationId,
        contactId: c.id,
        side: input.side,
        asOf: asDate(input.asOf),
      };
      const existing = await this.prisma.balanceConfirmation.findUnique({
        where: { organizationId_contactId_side_asOf: key },
      });
      const row =
        existing && existing.status === 'pending'
          ? await this.prisma.balanceConfirmation.update({
              where: { id: existing.id },
              data: { balance: BigInt(balance), currency },
            })
          : (existing ??
            (await this.prisma.balanceConfirmation.create({
              data: {
                ...key,
                currency,
                balance: BigInt(balance),
                token: randomBytes(24).toString('base64url'),
                createdById: ctx.actor.userId,
              },
            })));
      created.push({ contactId: c.id, name: c.name });
      if (!input.send) continue;
      if (row.status !== 'pending') {
        skipped.push({ contactId: c.id, name: c.name, reason: 'answered' });
        continue;
      }
      if (!mailOn) {
        skipped.push({ contactId: c.id, name: c.name, reason: 'mail_off' });
        continue;
      }
      if (!c.email) {
        skipped.push({ contactId: c.id, name: c.name, reason: 'no_email' });
        continue;
      }
      const from = org.legalName ?? org.name;
      const amount = this.money(Math.abs(balance), currency);
      const says =
        balance === 0
          ? `nothing is outstanding between us`
          : input.side === 'receivable'
            ? balance > 0
              ? `you owe us ${amount}`
              : `we owe you ${amount}`
            : balance > 0
              ? `we owe you ${amount}`
              : `you owe us ${amount}`;
      const sent = await this.mail.send({
        ...(await organizationSender(this.prisma, organizationId)),
        to: [c.email],
        subject: `Balance confirmation as on ${input.asOf}: ${from}`,
        text: `Dear ${c.legalName ?? c.name},\n\nFor our audit, please confirm your balance with us. As per our books, on ${input.asOf} ${says}.\n\nAgree, or tell us what your books show, here (no sign-in needed):\n${this.link(row.token)}\n\nThank you,\n${from}`,
      });
      if (sent) {
        emailed.push(c.id);
        await this.prisma.balanceConfirmation.update({
          where: { id: row.id },
          data: { sentTo: c.email },
        });
      } else
        skipped.push({ contactId: c.id, name: c.name, reason: 'mail_failed' });
    }
    await this.audit.record({
      action: 'org.balance_confirmation.request',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'organization',
      entityId: organizationId,
      after: {
        asOf: input.asOf,
        side: input.side,
        count: created.length,
        emailed: emailed.length,
      },
      req: ctx.req,
    });
    return { created: created.length, emailed: emailed.length, skipped };
  }

  async list(organizationId: string, asOf: string, side: ConfirmationSide) {
    const rows = await this.prisma.balanceConfirmation.findMany({
      where: { organizationId, asOf: asDate(asOf), side },
      orderBy: { contact: { name: 'asc' } },
      include: { contact: { select: { id: true, name: true, phone: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      contact: r.contact,
      currency: r.currency,
      balance: Number(r.balance),
      status: r.status,
      theirBalance: r.theirBalance === null ? null : Number(r.theirBalance),
      note: r.note,
      respondedBy: r.respondedBy,
      respondedAt: r.respondedAt,
      sentTo: r.sentTo,
      views: r.views,
      token: r.token,
    }));
  }

  private async find(token: string) {
    const bad = () =>
      new NotFoundException({
        message: 'This link isn’t valid. Ask the business for a new one.',
        details: { reason: 'not_found' },
      });
    if (!SHARE_TOKEN.test(token)) throw bad();
    const r = await this.prisma.balanceConfirmation.findUnique({
      where: { token },
      include: {
        contact: { select: { name: true, legalName: true } },
        organization: {
          select: {
            name: true,
            legalName: true,
            taxId: true,
            status: true,
            fiscalYearStartMonth: true,
          },
        },
      },
    });
    if (!r || r.organization.status !== 'ACTIVE') throw bad();
    return r;
  }

  /** What the party sees from their link */
  async view(token: string) {
    const r = await this.find(token);
    await this.prisma.balanceConfirmation.update({
      where: { id: r.id },
      data: { views: { increment: 1 } },
    });
    return {
      organization: {
        name: r.organization.legalName ?? r.organization.name,
        taxId: r.organization.taxId,
      },
      party: { name: r.contact.legalName ?? r.contact.name },
      side: r.side as ConfirmationSide,
      asOf: iso(r.asOf),
      currency: r.currency,
      balance: Number(r.balance),
      status: r.status,
      theirBalance: r.theirBalance === null ? null : Number(r.theirBalance),
      note: r.note,
      respondedBy: r.respondedBy,
      respondedAt: r.respondedAt,
    };
  }

  /** The statement behind the balance, from the start of that financial year to the day */
  async statementPdf(token: string) {
    const r = await this.find(token);
    const asOf = iso(r.asOf);
    const start = fiscalYearSpan(
      fiscalYearOf(asOf, r.organization.fiscalYearStartMonth),
      r.organization.fiscalYearStartMonth,
    ).periods[0]!.startDate;
    const s = await this.statements.statement(
      r.organizationId,
      r.contactId,
      plural(r.side as ConfirmationSide),
      start,
      asOf,
    );
    return this.statements.file(r.organizationId, s, 'pdf');
  }

  async respond(
    token: string,
    input: {
      response: 'agree' | 'dispute';
      name: string;
      theirBalance?: number | null;
      note?: string | null;
    },
  ) {
    const r = await this.find(token);
    if (r.status !== 'pending')
      throw new ConflictException({
        message:
          'This has been answered already. Contact the business to change it.',
        details: { reason: 'answered' },
      });
    const done = await this.prisma.balanceConfirmation.updateMany({
      where: { id: r.id, status: 'pending' },
      data: {
        status: input.response === 'agree' ? 'agreed' : 'disputed',
        theirBalance:
          input.response === 'dispute' && input.theirBalance != null
            ? BigInt(input.theirBalance)
            : null,
        note: input.note ?? null,
        respondedBy: input.name,
        respondedAt: new Date(),
      },
    });
    if (!done.count)
      throw new ConflictException({
        message: 'This has been answered already.',
        details: { reason: 'answered' },
      });
    await this.audit.record({
      action: `org.balance_confirmation.${input.response === 'agree' ? 'agreed' : 'disputed'}`,
      organizationId: r.organizationId,
      entityType: 'contact',
      entityId: r.contactId,
      after: { asOf: iso(r.asOf), side: r.side, by: input.name },
    });
    return this.view(token);
  }
}
