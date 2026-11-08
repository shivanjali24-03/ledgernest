import { BadRequestException, Injectable } from '@nestjs/common';
import { AUDIT_ACTION_GROUPS, AUDIT_EXPORT_LIMIT, csvCell, type AuditActionGroup } from '@ledgernest/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditFilter {
  group?: AuditActionGroup;
  actorId?: string;
  organizationId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
}

const select = {
  id: true,
  action: true,
  createdAt: true,
  actorEmail: true,
  entityType: true,
  entityId: true,
  before: true,
  after: true,
  ip: true,
  userAgent: true,
  actor: { select: { id: true, name: true, email: true } },
  organization: { select: { id: true, name: true } },
} as const;

type Row = Prisma.AuditLogGetPayload<{ select: typeof select }>;

/** Cursor = the last row's (createdAt, id), so paging is stable while new entries arrive. */
const encodeCursor = (r: { createdAt: Date; id: string }) => Buffer.from(JSON.stringify([r.createdAt.toISOString(), r.id])).toString('base64url');
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    const createdAt = new Date(at);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw new BadRequestException('That page link is not valid. Start from the first page.');
  }
}

/** Reads the append-only audit log for one organisation or for the whole platform. */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private where(f: AuditFilter, scope: { organizationId?: string }): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    const organizationId = scope.organizationId ?? f.organizationId;
    if (organizationId) and.push({ organizationId });
    if (f.group) and.push({ OR: AUDIT_ACTION_GROUPS[f.group].map((p) => ({ action: { startsWith: p } })) });
    if (f.actorId) and.push({ actorId: f.actorId });
    if (f.from) and.push({ createdAt: { gte: new Date(f.from) } });
    if (f.to) and.push({ createdAt: { lte: new Date(f.to) } });
    if (f.cursor) {
      const c = decodeCursor(f.cursor);
      and.push({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] });
    }
    return { AND: and };
  }

  private view(r: Row, includeOrganization: boolean) {
    return {
      id: r.id,
      action: r.action,
      createdAt: r.createdAt,
      // The live user if they still exist; otherwise the email captured when the entry was written
      actor: r.actor ?? (r.actorEmail ? { id: null, name: null, email: r.actorEmail } : null),
      ...(includeOrganization && { organization: r.organization }),
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
    };
  }

  async list(f: AuditFilter, scope: { organizationId?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(f, scope),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit + 1,
      select,
    });
    const page = rows.slice(0, f.limit);
    return {
      items: page.map((r) => this.view(r, !scope.organizationId)),
      nextCursor: rows.length > f.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  /** Up to 10,000 matching entries as CSV. Cells are protected against spreadsheet formula injection. */
  async csv(f: AuditFilter, scope: { organizationId?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where({ ...f, cursor: undefined }, scope),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AUDIT_EXPORT_LIMIT,
      select,
    });
    const platform = !scope.organizationId;
    const header = ['time', 'action', 'actor', ...(platform ? ['organization'] : []), 'entity_type', 'entity_id', 'ip', 'before', 'after'];
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.action,
        r.actor?.email ?? r.actorEmail,
        ...(platform ? [r.organization?.name ?? ''] : []),
        r.entityType,
        r.entityId,
        r.ip,
        r.before,
        r.after,
      ]
        .map(csvCell)
        .join(','),
    );
    // A byte-order mark so Excel opens UTF-8 (Hindi, Arabic names) correctly
    return { body: `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`, count: rows.length, truncated: rows.length === AUDIT_EXPORT_LIMIT };
  }
}
