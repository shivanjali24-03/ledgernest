import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { PASSWORD_RESET_MINUTES } from '@ledgernest/shared';
import type { Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestContext } from './auth.service.js';
import { hashToken } from './tokens.js';

const BAD_LINK = {
  message:
    'This reset link has expired or was already used. Ask for a new one.',
  details: { reason: 'invalid_token' },
};

/**
 * Passwords after sign-up: a reset link by email for a forgotten one (the same answer whether or not the address
 * has an account), changing your own while signed in, and signing out everywhere. Setting a new password signs
 * every device out, so a stolen session ends with it.
 */
@Injectable()
export class PasswordService {
  private readonly log = new Logger('Password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Emails a reset link when the address belongs to an active account; says nothing either way */
  async forgot(email: string, ctx: RequestContext, now = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      await this.audit('auth.password.reset_requested', ctx, undefined, {
        email,
        known: false,
      });
      return;
    }
    // At most three live links per person in a reset window: older ones stop working
    const live = await this.prisma.passwordReset.findMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (live.length >= 3)
      await this.prisma.passwordReset.updateMany({
        where: { id: { in: live.slice(2).map((r) => r.id) } },
        data: { usedAt: now },
      });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_MINUTES * 60_000),
        ip: ctx.ip,
      },
    });
    const link = `${this.config.get('WEB_APP_URL', { infer: true })}/reset-password?token=${token}`;
    if (!this.mail.configured)
      this.log.warn(
        `Email isn't set up, so the reset link for ${email} wasn't sent.`,
      );
    // Not awaited: answering as fast for known addresses as unknown ones keeps accounts from being probed by timing
    else
      void this.mail.send({
        to: [email],
        subject: 'Reset your LedgerNest password',
        text: [
          `Hello ${user.name},`,
          `Someone (we hope you) asked to reset the password for your LedgerNest account. Open this link within ${PASSWORD_RESET_MINUTES} minutes to choose a new one:`,
          link,
          'If you didn’t ask, ignore this email: your password stays as it is.',
          'LedgerNest',
        ].join('\n\n'),
      });
    await this.audit('auth.password.reset_requested', ctx, user.id, {
      known: true,
    });
  }

  /** Sets a new password from a reset link; the link is used up, the lockout cleared, every device signed out */
  async reset(
    token: string,
    password: string,
    ctx: RequestContext,
    now = new Date(),
  ) {
    const row = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= now ||
      row.user.status !== 'ACTIVE'
    )
      throw new BadRequestException(BAD_LINK);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // Used once: a second request with the same link finds it gone
      const used = await tx.passwordReset.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (!used.count) throw new BadRequestException(BAD_LINK);
      await tx.passwordReset.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    await this.audit('auth.password.reset', ctx, row.userId);
  }

  /** Changes your own password after checking the current one; other devices are signed out, this one stays */
  async change(
    userId: string,
    current: string,
    next: string,
    ctx: RequestContext & { refreshTokenHash?: string },
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!(await argon2.verify(user.passwordHash, current))) {
      await this.audit('auth.password.change_failed', ctx, userId);
      // 400, not 401: a 401 tells the app the session ended, which would sign the person out
      throw new BadRequestException({
        message: 'Your current password isn’t right.',
        details: { reason: 'wrong_password' },
      });
    }
    const passwordHash = await argon2.hash(next, { type: argon2.argon2id });
    const keep = ctx.refreshTokenHash
      ? await this.prisma.refreshToken.findUnique({
          where: { tokenHash: ctx.refreshTokenHash },
          select: { familyId: true, userId: true },
        })
      : null;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keep?.userId === userId
            ? { familyId: { not: keep.familyId } }
            : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit('auth.password.change', ctx, userId);
  }

  /** Signs out every device, this one included */
  async signOutEverywhere(userId: string, ctx: RequestContext) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit('auth.logout_all', ctx, userId, { sessions: r.count });
    return { sessions: r.count };
  }

  private audit(
    action: string,
    ctx: RequestContext,
    actorId?: string,
    after?: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        action,
        actorId,
        entityType: 'user',
        entityId: actorId,
        after: after as object | undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 255),
      },
    });
  }
}
