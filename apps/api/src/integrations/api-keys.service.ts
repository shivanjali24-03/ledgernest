import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { API_KEY_PREFIX, type apiKeyCreateSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const select = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdBy: { select: { name: true, email: true } },
} as const;

/** The organisation's API keys. A key is shown once, when made; after that only its first characters. */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: [
        { revokedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
      select,
    });
    const now = new Date();
    return rows.map((k) => ({
      ...k,
      status: k.revokedAt
        ? ('revoked' as const)
        : k.expiresAt && k.expiresAt <= now
          ? ('expired' as const)
          : ('active' as const),
    }));
  }

  /** The key itself is in the response, and nowhere else afterwards */
  async create(input: z.output<typeof apiKeyCreateSchema>, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    // A key can't do what its maker can't
    const beyond = input.scopes.filter((s) => !ctx.tenant.permissions.has(s));
    if (beyond.length)
      throw new ForbiddenException({
        message: 'A key can only do what you can do yourself.',
        details: { reason: 'scope_not_yours', missing: beyond },
      });
    const secret = `${API_KEY_PREFIX}${randomBytes(30).toString('base64url')}`;
    const prefix = secret.slice(0, API_KEY_PREFIX.length + 6);
    const k = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          organizationId,
          name: input.name,
          prefix,
          hash: createHash('sha256').update(secret).digest('hex'),
          scopes: input.scopes,
          createdById: ctx.actor.userId,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : null,
        },
        select,
      });
      await this.audit.record(
        {
          action: 'org.api_key.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'api_key',
          entityId: created.id,
          after: {
            name: input.name,
            prefix,
            scopes: input.scopes,
            expiresAt: created.expiresAt,
          },
          req: ctx.req,
        },
        tx,
      );
      return created;
    });
    return { ...k, status: 'active' as const, key: secret };
  }

  async revoke(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const k = await this.prisma.apiKey.findFirst({
      where: { organizationId, id },
      select: { id: true, name: true, prefix: true, revokedAt: true },
    });
    if (!k) throw new NotFoundException('API key not found.');
    if (k.revokedAt)
      throw new ConflictException({
        message: 'This key is already revoked.',
        details: { reason: 'already_revoked' },
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.api_key.revoke',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'api_key',
          entityId: id,
          before: { name: k.name, prefix: k.prefix },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
