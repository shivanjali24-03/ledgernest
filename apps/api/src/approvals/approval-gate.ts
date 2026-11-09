import { ConflictException, Injectable } from '@nestjs/common';
import {
  currencyDigits,
  needsApproval,
  toBase,
  type ApprovalDocument,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { rateOn } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/**
 * Checked before a journal entry, bill or vendor payment posts. When a rule covers it and it hasn't been
 * approved, it's held: a pending request is made (or the one already waiting is pointed to) and posting is
 * refused with approval_required, which callers show as "sent for approval". Approving posts it, passing
 * approved: true so this lets it through.
 */
@Injectable()
export class ApprovalGate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** An amount in another currency, in the base currency at the day's rate (or the one given) */
  async inBase(
    organizationId: string,
    amount: number,
    currency: string | null,
    day: string,
    rate?: string | null,
  ) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (!currency || currency === baseCurrency) return amount;
    const r =
      rate ?? (await rateOn(this.prisma, organizationId, currency, day))?.rate;
    return r
      ? toBase(
          amount,
          r,
          currencyDigits(currency),
          currencyDigits(baseCurrency),
        )
      : amount;
  }

  async check(
    documentType: ApprovalDocument,
    held: {
      documentId: string | null;
      amount: number;
      summary: string;
      payload?: Prisma.InputJsonValue;
    },
    ctx: Ctx,
    opts: { approved?: boolean } = {},
  ) {
    if (opts.approved) return;
    const organizationId = ctx.tenant.organizationId;
    const rule = await this.prisma.approvalRule.findUnique({
      where: { organizationId_documentType: { organizationId, documentType } },
      select: { minAmount: true },
    });
    if (
      !needsApproval(rule && { minAmount: Number(rule.minAmount) }, held.amount)
    )
      return;
    const waiting = held.documentId
      ? await this.prisma.approvalRequest.findFirst({
          where: {
            organizationId,
            documentType,
            documentId: held.documentId,
            status: 'pending',
          },
          select: { id: true },
        })
      : null;
    const request =
      waiting ??
      (await this.prisma.$transaction(async (tx) => {
        const r = await tx.approvalRequest.create({
          data: {
            organizationId,
            documentType,
            documentId: held.documentId,
            payload: held.payload,
            amount: BigInt(held.amount),
            summary: held.summary,
            requestedById: ctx.actor.userId,
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: 'org.approval.request',
            actorId: ctx.actor.userId,
            organizationId,
            entityType: documentType,
            entityId: held.documentId ?? r.id,
            after: { summary: held.summary, amount: held.amount },
            req: ctx.req,
          },
          tx,
        );
        return r;
      }));
    throw new ConflictException({
      message: waiting
        ? 'This is already waiting for approval.'
        : 'This needs approval, so it has been sent to an approver. It posts once approved.',
      details: {
        reason: waiting ? 'approval_pending' : 'approval_required',
        requestId: request.id,
        minAmount: Number(rule!.minAmount),
      },
    });
  }
}
