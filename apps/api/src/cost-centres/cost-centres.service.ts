import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { costCentreSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Input = z.output<typeof costCentreSchema>;
const select = {
  id: true,
  code: true,
  name: true,
  kind: true,
  description: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Cost centres and projects: parts of the business lines are tagged with, to see profit by each. */
@Injectable()
export class CostCentresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async find(organizationId: string, id: string) {
    const c = await this.prisma.costCentre.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!c) throw new NotFoundException('Cost centre not found.');
    return c;
  }

  private async used(organizationId: string, id: string) {
    const [j, i, b] = await Promise.all([
      this.prisma.journalLine.count({
        where: { organizationId, costCentreId: id },
      }),
      this.prisma.invoiceLine.count({
        where: { organizationId, costCentreId: id },
      }),
      this.prisma.billLine.count({
        where: { organizationId, costCentreId: id },
      }),
    ]);
    return j + i + b;
  }

  private view(
    c: Awaited<ReturnType<CostCentresService['find']>>,
    lines?: number,
  ) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      kind: c.kind as 'department' | 'project',
      description: c.description,
      archived: !!c.archivedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(lines === undefined ? {} : { lines }),
    };
  }

  async list(organizationId: string, includeArchived: boolean) {
    const rows = await this.prisma.costCentre.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { code: 'asc' },
      ],
      select: { ...select, _count: { select: { journalLines: true } } },
    });
    return rows.map((c) => this.view(c, c._count.journalLines));
  }

  private async codeTaken(
    organizationId: string,
    code: string,
    except?: string,
  ) {
    return !!(await this.prisma.costCentre.findFirst({
      where: {
        organizationId,
        code,
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    }));
  }

  async create(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    if (await this.codeTaken(organizationId, input.code))
      throw new ConflictException({
        message: 'Another cost centre has this code.',
        details: { reason: 'code_taken', field: 'code' },
      });
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.costCentre.create({
        data: { organizationId, ...input },
        select,
      });
      await this.audit.record(
        {
          action: 'org.cost_centre.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'cost_centre',
          entityId: created.id,
          after: { code: created.code, name: created.name, kind: created.kind },
          req: ctx.req,
        },
        tx,
      );
      return created;
    });
    return this.view(c);
  }

  async update(id: string, input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    if (await this.codeTaken(organizationId, input.code, id))
      throw new ConflictException({
        message: 'Another cost centre has this code.',
        details: { reason: 'code_taken', field: 'code' },
      });
    const c = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.costCentre.update({
        where: { id },
        data: input,
        select,
      });
      await this.audit.record(
        {
          action: 'org.cost_centre.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'cost_centre',
          entityId: id,
          before: {
            code: before.code,
            name: before.name,
            kind: before.kind,
            description: before.description,
          },
          after: {
            code: updated.code,
            name: updated.name,
            kind: updated.kind,
            description: updated.description,
          },
          req: ctx.req,
        },
        tx,
      );
      return updated;
    });
    return this.view(c);
  }

  async archive(id: string, archived: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const before = await this.find(organizationId, id);
    const c = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.costCentre.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select,
      });
      await this.audit.record(
        {
          action: archived
            ? 'org.cost_centre.archive'
            : 'org.cost_centre.restore',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'cost_centre',
          entityId: id,
          after: { code: before.code, name: before.name },
          req: ctx.req,
        },
        tx,
      );
      return updated;
    });
    return this.view(c);
  }

  /** Only one nothing has been tagged with; otherwise archive it */
  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const c = await this.find(organizationId, id);
    if (await this.used(organizationId, id))
      throw new ConflictException({
        message: 'Lines are tagged with this cost centre. Archive it instead.',
        details: { reason: 'in_use' },
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.costCentre.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.cost_centre.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'cost_centre',
          entityId: id,
          before: { code: c.code, name: c.name },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
