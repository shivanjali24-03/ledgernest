import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessRequest } from '../access/types.js';

/** Anything that can write an audit row: the client, a transaction, or an organisation-scoped client. */
export type AuditWriter = {
  auditLog: {
    create(args: {
      data: Prisma.AuditLogUncheckedCreateInput;
    }): PromiseLike<unknown>;
  };
};

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

  record(e: AuditEntry, db: AuditWriter = this.prisma) {
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
        // Done with an API key: say which, so the trail shows what acted for the person
        userAgent: ((e.req as AccessRequest | undefined)?.actor?.apiKey
          ? `API key ${(e.req as AccessRequest).actor!.apiKey!.prefix}… · ${(e.req as AccessRequest).actor!.apiKey!.name}`
          : (e.req?.headers['user-agent'] as string | undefined)
        )?.slice(0, 255),
      },
    });
  }
}
