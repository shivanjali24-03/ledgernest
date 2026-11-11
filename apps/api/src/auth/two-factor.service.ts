import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { totpUri } from '@ledgernest/shared';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestContext } from './auth.service.js';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  openSecret,
  sealSecret,
  verifyTotp,
} from './totp.js';

const refuse = (message: string, reason: string) =>
  new BadRequestException({ message, details: { reason } });

/**
 * Two-factor sign-in with an authenticator app. Setting up asks for the password and gives a secret to scan;
 * entering a code from the app turns it on and gives ten one-time recovery codes. Turning it off needs both the
 * password and a code. Codes can't be used twice.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.serverSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }
  private readonly serverSecret: string;

  private async user(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        totpSecret: true,
        totpEnabledAt: true,
        totpLastStep: true,
        recoveryCodes: true,
      },
    });
  }

  private async password(hash: string, password: string) {
    if (!(await argon2.verify(hash, password)))
      throw refuse('That password is not right.', 'wrong_password');
  }

  private audit(action: string, userId: string, ctx: RequestContext) {
    return this.prisma.auditLog.create({
      data: {
        action,
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 255),
      },
    });
  }

  async status(userId: string) {
    const u = await this.user(userId);
    return {
      enabled: !!u.totpEnabledAt,
      enabledAt: u.totpEnabledAt,
      recoveryCodesLeft: u.recoveryCodes.length,
    };
  }

  /** A new secret to scan, kept until a code from it turns two-factor on */
  async setup(userId: string, password: string) {
    const u = await this.user(userId);
    await this.password(u.passwordHash, password);
    if (u.totpEnabledAt)
      throw new ConflictException({
        message: 'Two-factor sign-in is already on.',
        details: { reason: 'already_enabled' },
      });
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: sealSecret(secret, this.serverSecret) },
    });
    return { secret, uri: totpUri(secret, u.email) };
  }

  async enable(userId: string, code: string, ctx: RequestContext) {
    const u = await this.user(userId);
    if (u.totpEnabledAt)
      throw new ConflictException({
        message: 'Two-factor sign-in is already on.',
        details: { reason: 'already_enabled' },
      });
    if (!u.totpSecret) throw refuse('Start the set-up first.', 'not_set_up');
    const step = verifyTotp(openSecret(u.totpSecret, this.serverSecret), code);
    if (step === null)
      throw refuse(
        'That code isn’t right. Check the time on your phone and try the newest code.',
        'wrong_code',
      );
    const { codes, hashes } = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpLastStep: step,
        recoveryCodes: hashes,
      },
    });
    await this.audit('auth.2fa.enabled', userId, ctx);
    return { recoveryCodes: codes };
  }

  /**
   * Checks a code from the app (once per step) or a recovery code (once ever), using it up. False when wrong.
   */
  async check(userId: string, code: string): Promise<boolean> {
    const u = await this.user(userId);
    if (!u.totpEnabledAt || !u.totpSecret) return false;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(
        openSecret(u.totpSecret, this.serverSecret),
        code,
      );
      if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep))
        return false;
      // Only if no one else used this step meanwhile
      const r = await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      return r.count === 1;
    }
    const hash = hashRecoveryCode(code);
    if (!u.recoveryCodes.includes(hash)) return false;
    const r = await this.prisma.user.updateMany({
      where: { id: userId, recoveryCodes: { has: hash } },
      data: { recoveryCodes: u.recoveryCodes.filter((h) => h !== hash) },
    });
    return r.count === 1;
  }

  async disable(
    userId: string,
    password: string,
    code: string,
    ctx: RequestContext,
  ) {
    const u = await this.user(userId);
    await this.password(u.passwordHash, password);
    if (!u.totpEnabledAt) return;
    if (!(await this.check(userId, code)))
      throw refuse('That code isn’t right.', 'wrong_code');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        recoveryCodes: [],
      },
    });
    await this.audit('auth.2fa.disabled', userId, ctx);
  }

  /** New recovery codes, the old ones stop working */
  async regenerate(userId: string, code: string, ctx: RequestContext) {
    if (!(await this.check(userId, code)))
      throw refuse('That code isn’t right.', 'wrong_code');
    const { codes, hashes } = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { recoveryCodes: hashes },
    });
    await this.audit('auth.2fa.recovery_codes', userId, ctx);
    return { recoveryCodes: codes };
  }
}
