import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  gstinStateCode,
  INDIAN_STATES,
  panOfGstin,
  type gstRegistrationSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });

const select = {
  id: true,
  gstin: true,
  stateCode: true,
  tradeName: true,
  address: true,
  archivedAt: true,
} as const;

/** A registration a document names: it must be the organisation's and in use */
export async function registrationFor(
  tx: Tx | PrismaService,
  organizationId: string,
  id: string | null | undefined,
) {
  if (!id) return null;
  const r = await tx.gstRegistration.findFirst({
    where: { organizationId, id },
    select,
  });
  if (!r || r.archivedAt)
    throw refuse(
      BadRequestException,
      'Choose a GST registration in use.',
      'registration_invalid',
      { field: 'gstRegistrationId' },
    );
  return r;
}

/**
 * The organisation's further GST registrations: a GSTIN for each other state it does business from, under the same
 * PAN. Its own GSTIN (in the organisation's settings) is the first and isn't kept here.
 */
@Injectable()
export class GstRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(r: Prisma.GstRegistrationGetPayload<{ select: typeof select }>) {
    return {
      id: r.id,
      gstin: r.gstin,
      stateCode: r.stateCode,
      state: INDIAN_STATES.find((s) => s.code === r.stateCode)?.name ?? null,
      tradeName: r.tradeName,
      address: r.address as Record<string, string | null> | null,
      archived: !!r.archivedAt,
    };
  }

  async list(organizationId: string) {
    const [org, rows] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { taxId: true, region: true },
      }),
      this.prisma.gstRegistration.findMany({
        where: { organizationId },
        orderBy: [{ archivedAt: 'asc' }, { gstin: 'asc' }],
        select,
      }),
    ]);
    return {
      /** The organisation's own GSTIN: documents that name none are under it */
      primary: org.taxId
        ? { gstin: org.taxId, stateCode: gstinStateCode(org.taxId) }
        : null,
      registrations: rows.map((r) => this.view(r)),
    };
  }

  async create(input: z.output<typeof gstRegistrationSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gst-registrations:' + organizationId}))`;
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { taxId: true, pan: true, country: true },
      });
      if (org.country !== 'IN' || !org.taxId)
        throw refuse(
          ConflictException,
          'Enter the organisation’s own GSTIN in Settings first.',
          'no_primary_gstin',
        );
      if (input.gstin === org.taxId.toUpperCase())
        throw refuse(
          ConflictException,
          'That’s the organisation’s own GSTIN.',
          'gstin_is_organisation',
          { field: 'gstin' },
        );
      // One business, one PAN: every GSTIN of it carries the same one
      const pan = (org.pan ?? panOfGstin(org.taxId)).toUpperCase();
      if (panOfGstin(input.gstin) !== pan)
        throw refuse(
          BadRequestException,
          `This GSTIN is under another PAN (${panOfGstin(input.gstin)}, not ${pan}): a separate business is a separate organisation.`,
          'gstin_other_pan',
          { field: 'gstin' },
        );
      if (
        await tx.gstRegistration.findFirst({
          where: { organizationId, gstin: input.gstin },
          select: { id: true },
        })
      )
        throw refuse(
          ConflictException,
          'This GSTIN is already here.',
          'gstin_taken',
          { field: 'gstin' },
        );
      const r = await tx.gstRegistration.create({
        data: {
          organizationId,
          gstin: input.gstin,
          stateCode: gstinStateCode(input.gstin)!,
          tradeName: input.tradeName,
          address: (input.address ?? undefined) as
            Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'org.gst_registration.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'gst_registration',
          entityId: r.id,
          after: { gstin: input.gstin },
          req: ctx.req,
        },
        tx,
      );
      return r.id;
    });
    return this.view(
      await this.prisma.gstRegistration.findUniqueOrThrow({
        where: { id },
        select,
      }),
    );
  }

  async update(
    id: string,
    input: { tradeName?: string | null; address?: object | null },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.prisma.gstRegistration.findFirst({
      where: { organizationId, id },
      select: { id: true },
    });
    if (!r) throw new NotFoundException('GST registration not found.');
    await this.prisma.gstRegistration.update({
      where: { id },
      data: {
        ...(input.tradeName !== undefined && { tradeName: input.tradeName }),
        ...(input.address !== undefined && {
          address: (input.address ?? undefined) as
            Prisma.InputJsonValue | undefined,
        }),
      },
    });
    await this.audit.record({
      action: 'org.gst_registration.update',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'gst_registration',
      entityId: id,
      after: input,
      req: ctx.req,
    });
    return this.view(
      await this.prisma.gstRegistration.findUniqueOrThrow({
        where: { id },
        select,
      }),
    );
  }

  /** Cancelled or surrendered: kept for the documents under it, offered for no new ones */
  async archive(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.prisma.gstRegistration.findFirst({
      where: { organizationId, id },
      select: { id: true, gstin: true },
    });
    if (!r) throw new NotFoundException('GST registration not found.');
    await this.prisma.gstRegistration.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await this.audit.record({
      action: 'org.gst_registration.archive',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'gst_registration',
      entityId: id,
      before: { gstin: r.gstin },
      req: ctx.req,
    });
  }
}
