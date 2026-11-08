import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  /** e.g. platform.organization.suspend */
  action: string;
  actorId?: string | null;
  organizationId?: string | null;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Adds IP and user agent */
  req?: Pick<Request, 'ip' | 'headers'>;
}

/** Writes to the append-only audit log. Every change an admin makes goes through here. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(e: AuditEntry, db: Pick<PrismaService, 'auditLog'> = this.prisma) {
    return db.auditLog.create({
      data: {
        action: e.action,
        actorId: e.actorId ?? null,
        organizationId: e.organizationId ?? null,
        entityType: e.entityType,
        entityId: e.entityId,
        before: (e.before ?? undefined) as object | undefined,
        after: (e.after ?? undefined) as object | undefined,
        ip: e.req?.ip,
        userAgent: (e.req?.headers['user-agent'] as string | undefined)?.slice(0, 255),
      },
    });
  }
}
