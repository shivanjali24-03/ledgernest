import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestContext } from './auth.service.js';

/**
 * Deleting your own account. Accounting records have to be kept for years, so the person is erased rather than
 * the rows: name and email replaced, sign-in impossible, sessions and memberships gone. What they posted stays,
 * credited to "Deleted user". An organisation's only Owner hands it over (or deletes it) first.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async remove(userId: string, password: string, ctx: RequestContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, isSuperAdmin: true },
    });
    if (!(await argon2.verify(user.passwordHash, password)))
      throw new BadRequestException({
        message: 'Your password isn’t right.',
        details: { reason: 'wrong_password' },
      });
    // Organisations where this is the only Owner would be left with no one in charge
    const owned = await this.prisma.membership.findMany({
      where: { userId, builtInRole: 'owner' },
      select: { organization: { select: { id: true, name: true } } },
    });
    const sole: string[] = [];
    for (const m of owned) {
      const owners = await this.prisma.membership.count({
        where: { organizationId: m.organization.id, builtInRole: 'owner' },
      });
      if (owners === 1) sole.push(m.organization.name);
    }
    if (sole.length)
      throw new ConflictException({
        message: `You’re the only Owner of ${sole.join(', ')}. Make someone else Owner, or delete the organisation, first.`,
        details: { reason: 'sole_owner', organizations: sole },
      });
    if (user.isSuperAdmin) {
      const admins = await this.prisma.user.count({
        where: { isSuperAdmin: true, status: 'ACTIVE' },
      });
      if (admins <= 1)
        throw new ConflictException({
          message:
            'You’re the only Super Admin. Make someone else Super Admin first.',
          details: { reason: 'last_super_admin' },
        });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.membership.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.passwordReset.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: 'Deleted user',
          email: `deleted-${userId}@deleted.invalid`,
          passwordHash: await argon2.hash(randomBytes(32).toString('hex'), {
            type: argon2.argon2id,
          }),
          status: 'SUSPENDED',
          isSuperAdmin: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          action: 'user.deleted',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent?.slice(0, 255),
        },
      }),
    ]);
  }
}
