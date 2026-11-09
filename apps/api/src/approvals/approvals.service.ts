import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  APPROVAL_DOCUMENTS,
  type ApprovalDocument,
  type ApprovalStatus,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { BillsService } from '../bills/bills.service.js';
import { JournalsService } from '../journals/journals.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApprovalGate } from './approval-gate.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const select = {
  id: true,
  documentType: true,
  documentId: true,
  amount: true,
  summary: true,
  status: true,
  note: true,
  createdAt: true,
  decidedAt: true,
  payload: true,
  requestedById: true,
  requestedBy: { select: { name: true, email: true } },
  decidedBy: { select: { name: true, email: true } },
} as const;

/** Approval rules, and the requests they hold: approving one posts it as the approver; sending it back leaves it as it was. */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gate: ApprovalGate,
    private readonly journals: JournalsService,
    private readonly bills: BillsService,
    private readonly payments: PaymentsService,
  ) {}

  // ---------- rules ----------

  async rules(organizationId: string) {
    const rows = await this.prisma.approvalRule.findMany({
      where: { organizationId },
      select: { documentType: true, minAmount: true, updatedAt: true },
    });
    return APPROVAL_DOCUMENTS.map((d) => {
      const r = rows.find((x) => x.documentType === d);
      return {
        documentType: d,
        enabled: !!r,
        minAmount: r ? Number(r.minAmount) : null,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  async setRule(documentType: ApprovalDocument, minAmount: number, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.approvalRule.findUnique({
        where: {
          organizationId_documentType: { organizationId, documentType },
        },
        select: { minAmount: true },
      });
      await tx.approvalRule.upsert({
        where: {
          organizationId_documentType: { organizationId, documentType },
        },
        create: { organizationId, documentType, minAmount: BigInt(minAmount) },
        update: { minAmount: BigInt(minAmount) },
      });
      await this.audit.record(
        {
          action: 'org.approval.rule',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'approval_rule',
          entityId: documentType,
          before: before
            ? { documentType, minAmount: Number(before.minAmount) }
            : null,
          after: { documentType, minAmount },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.rules(organizationId);
  }

  async removeRule(documentType: ApprovalDocument, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.approvalRule.findUnique({
        where: {
          organizationId_documentType: { organizationId, documentType },
        },
        select: { minAmount: true },
      });
      if (!before) return;
      await tx.approvalRule.delete({
        where: {
          organizationId_documentType: { organizationId, documentType },
        },
      });
      await this.audit.record(
        {
          action: 'org.approval.rule',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'approval_rule',
          entityId: documentType,
          before: { documentType, minAmount: Number(before.minAmount) },
          after: null,
          req: ctx.req,
        },
        tx,
      );
    });
    return this.rules(organizationId);
  }

  // ---------- requests ----------

  private view(r: Awaited<ReturnType<ApprovalsService['find']>>) {
    return {
      id: r.id,
      documentType: r.documentType as ApprovalDocument,
      documentId: r.documentId,
      amount: Number(r.amount),
      summary: r.summary,
      status: r.status as ApprovalStatus,
      note: r.note,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      requestedBy: r.requestedBy,
      decidedBy: r.decidedBy,
      payment:
        r.documentType === 'payment'
          ? (r.payload as { date: string; reference: string | null } | null)
          : null,
    };
  }

  private async find(organizationId: string, id: string) {
    const r = await this.prisma.approvalRequest.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!r) throw new NotFoundException('Approval request not found.');
    return r;
  }

  async list(organizationId: string, status?: ApprovalStatus) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { organizationId, ...(status && { status }) },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 200,
      select,
    });
    const pending = await this.prisma.approvalRequest.count({
      where: { organizationId, status: 'pending' },
    });
    return { items: rows.map((r) => this.view(r)), pending };
  }

  private async decide(
    organizationId: string,
    id: string,
    status: ApprovalStatus,
    actorId: string,
    note: string | null,
    documentId?: string | null,
  ) {
    // Only one decision: the update applies only while it's still pending
    const done = await this.prisma.approvalRequest.updateMany({
      where: { organizationId, id, status: 'pending' },
      data: {
        status,
        decidedById: actorId,
        decidedAt: new Date(),
        note,
        ...(documentId !== undefined && { documentId }),
      },
    });
    if (!done.count)
      throw refuse(
        ConflictException,
        'Someone has already decided on this.',
        'already_decided',
      );
  }

  /** Approves and posts it, as the approver. Refused for one's own request, or if the document has changed. */
  async approve(id: string, note: string | null, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.status !== 'pending')
      throw refuse(
        ConflictException,
        'Someone has already decided on this.',
        'already_decided',
      );
    if (r.requestedById === ctx.actor.userId)
      throw refuse(
        ConflictException,
        'Someone else has to approve what you sent.',
        'own_request',
      );
    const amount = Number(r.amount);
    let documentId = r.documentId;
    if (r.documentType === 'journal') {
      const e = await this.journals
        .get(organizationId, r.documentId!)
        .catch(() => null);
      if (!e || e.status !== 'draft')
        return this.stale(organizationId, id, ctx);
      if (e.totals.debit !== amount)
        throw refuse(
          ConflictException,
          'The entry has changed since it was sent. Send it back so it can be sent again.',
          'document_changed',
        );
      await this.journals.post(e.id, ctx, { approved: true });
    } else if (r.documentType === 'bill') {
      const b = await this.bills
        .get(organizationId, r.documentId!)
        .catch(() => null);
      if (!b || b.status !== 'draft')
        return this.stale(organizationId, id, ctx);
      if (
        (await this.gate.inBase(
          organizationId,
          b.total,
          b.currency,
          b.billDate,
          b.rate,
        )) !== amount
      )
        throw refuse(
          ConflictException,
          'The bill has changed since it was sent. Send it back so it can be sent again.',
          'document_changed',
        );
      await this.bills.record(b.id, ctx, { approved: true });
    } else {
      const p = await this.payments.pay(
        r.payload as unknown as Parameters<PaymentsService['pay']>[0],
        ctx,
        { approved: true },
      );
      documentId = p.id;
    }
    await this.decide(
      organizationId,
      id,
      'approved',
      ctx.actor.userId,
      note,
      documentId,
    );
    await this.audit.record({
      action: 'org.approval.approve',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: r.documentType,
      entityId: documentId ?? r.id,
      after: { summary: r.summary, amount, note },
      req: ctx.req,
    });
    return this.view(await this.find(organizationId, id));
  }

  /** The document went away (deleted, or posted some other way): the request closes */
  private async stale(organizationId: string, id: string, ctx: Ctx) {
    await this.decide(organizationId, id, 'cancelled', ctx.actor.userId, null);
    throw refuse(
      ConflictException,
      'This document is no longer a draft, so there’s nothing to approve.',
      'document_gone',
    );
  }

  async reject(id: string, note: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.status !== 'pending')
      throw refuse(
        ConflictException,
        'Someone has already decided on this.',
        'already_decided',
      );
    await this.decide(organizationId, id, 'rejected', ctx.actor.userId, note);
    await this.audit.record({
      action: 'org.approval.reject',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: r.documentType,
      entityId: r.documentId ?? r.id,
      after: { summary: r.summary, amount: Number(r.amount), note },
      req: ctx.req,
    });
    return this.view(await this.find(organizationId, id));
  }

  /** The one who sent it can take it back */
  async cancel(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.find(organizationId, id);
    if (r.requestedById !== ctx.actor.userId)
      throw refuse(
        ConflictException,
        'Only the person who sent it can withdraw it.',
        'not_yours',
      );
    await this.decide(organizationId, id, 'cancelled', ctx.actor.userId, null);
    await this.audit.record({
      action: 'org.approval.cancel',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: r.documentType,
      entityId: r.documentId ?? r.id,
      after: { summary: r.summary },
      req: ctx.req,
    });
  }
}
