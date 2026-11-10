import { Injectable, NotFoundException } from '@nestjs/common';
import { describeUserAgent } from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestContext } from './auth.service.js';
import { hashToken } from './tokens.js';

/**
 * Where you're signed in: one entry per sign-in (a refresh-token family), with the device, the address it was last
 * used from and when. Any of them can be signed out from here.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, rawToken?: string) {
    const now = new Date();
    const current = rawToken
      ? (
          await this.prisma.refreshToken.findUnique({
            where: { tokenHash: hashToken(rawToken) },
            select: { familyId: true },
          })
        )?.familyId
      : undefined;
    const live = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: {
        familyId: true,
        createdAt: true,
        ip: true,
        userAgent: true,
      },
    });
    const families = [...new Map(live.map((t) => [t.familyId, t])).values()];
    const started = await this.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { familyId: { in: families.map((f) => f.familyId) } },
      _min: { createdAt: true },
    });
    return families
      .map((t) => ({
        id: t.familyId,
        current: t.familyId === current,
        startedAt:
          started.find((s) => s.familyId === t.familyId)?._min.createdAt ??
          t.createdAt,
        lastUsedAt: t.createdAt,
        ip: t.ip,
        device: describeUserAgent(t.userAgent),
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
      );
  }

  async revoke(userId: string, familyId: string, ctx: RequestContext) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count)
      throw new NotFoundException({
        message: 'That session has already ended.',
        details: { reason: 'not_found' },
      });
    await this.prisma.auditLog.create({
      data: {
        action: 'auth.session.revoked',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        after: { familyId },
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 255),
      },
    });
  }
}
