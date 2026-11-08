import { randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  LOCKOUT,
  TOKENS,
  isBuiltInRole,
} from '@ledgernest/shared';
import { membershipPermissions } from '../access/membership-permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashToken, newRefreshToken } from './tokens.js';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface AccessPayload {
  sub: string;
  /** Platform Super Admin */
  sa: boolean;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Same message for "no such user" and "wrong password", so emails can't be probed. */
const BAD_CREDENTIALS = 'Email or password is incorrect.';

/** Verified when the email doesn't exist, so both paths take about the same time. */
const DUMMY_HASH = await argon2.hash('ledgernest-timing-equaliser', { type: argon2.argon2id });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, ctx: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await argon2.verify(DUMMY_HASH, password);
      await this.audit('auth.login.failed', { ctx, after: { email, reason: 'unknown_email' } });
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      await this.audit('auth.login.locked', { ctx, actorId: user.id });
      throw new HttpException(
        { message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, details: { retryAfterMinutes: minutes } },
        HttpStatus.LOCKED,
      );
    }

    if (!(await argon2.verify(user.passwordHash, password))) {
      const failures = user.failedLoginAttempts + 1;
      const lock = failures >= LOCKOUT.maxFailedAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT.minutes * 60_000) }
          : { failedLoginAttempts: failures },
      });
      await this.audit(lock ? 'auth.lockout' : 'auth.login.failed', { ctx, actorId: user.id, after: { failures } });
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    // Checked only after the password, so suspended accounts can't be discovered by guessing
    if (user.status === 'SUSPENDED') {
      await this.audit('auth.login.suspended', { ctx, actorId: user.id });
      throw new ForbiddenException('This account is suspended. Contact your administrator.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit('auth.login.success', { ctx, actorId: user.id });
    return this.issue(user.id, user.isSuperAdmin, randomUUID(), ctx);
  }

  /** Rotates the refresh token. Reusing an old one means it was stolen: the whole family is revoked. */
  async refresh(rawToken: string | undefined, ctx: RequestContext) {
    if (!rawToken) throw new UnauthorizedException('Please sign in again.');
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!token) throw new UnauthorizedException('Please sign in again.');

    if (token.revokedAt) {
      await this.revokeFamily(token.familyId);
      await this.audit('auth.refresh.reuse_detected', { ctx, actorId: token.userId, after: { familyId: token.familyId } });
      throw new UnauthorizedException('Please sign in again.');
    }
    if (token.expiresAt <= new Date()) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    if (token.user.status === 'SUSPENDED') {
      await this.revokeFamily(token.familyId);
      throw new ForbiddenException('This account is suspended. Contact your administrator.');
    }

    const issued = await this.issue(token.userId, token.user.isSuperAdmin, token.familyId, ctx, token.id);
    return issued;
  }

  /** Signs out this device: every token in the session family is revoked. */
  async logout(rawToken: string | undefined, ctx: RequestContext) {
    if (!rawToken) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token) return;
    await this.revokeFamily(token.familyId);
    await this.audit('auth.logout', { ctx, actorId: token.userId });
  }

  /** The signed-in user, their organisations and what they may do in each. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { organization: true, customRole: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!user || user.status === 'SUSPENDED') throw new UnauthorizedException('Please sign in again.');

    const organizations = user.memberships.map((m) => {
      const builtIn = m.builtInRole && isBuiltInRole(m.builtInRole) ? BUILT_IN_ROLES[m.builtInRole] : null;
      const permissions = [...membershipPermissions(m)];
      return {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        status: m.organization.status,
        baseCurrency: m.organization.baseCurrency,
        locale: m.organization.locale,
        role: builtIn ? { type: 'built_in' as const, key: builtIn.id } : { type: 'custom' as const, key: m.customRoleId, name: m.customRole?.name },
        permissions,
      };
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale, isSuperAdmin: user.isSuperAdmin },
      platformPermissions: user.isSuperAdmin ? ALL_PERMISSIONS.filter((p) => p.startsWith('platform.')) : [],
      organizations,
    };
  }

  // ---- helpers ----

  private async issue(userId: string, isSuperAdmin: boolean, familyId: string, ctx: RequestContext, replaces?: string): Promise<IssuedTokens> {
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + TOKENS.refreshDays * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId, familyId, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 255) },
      });
      if (replaces) await tx.refreshToken.update({ where: { id: replaces }, data: { revokedAt: new Date(), replacedById: created.id } });
    });
    const payload: AccessPayload = { sub: userId, sa: isSuperAdmin };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: `${TOKENS.accessMinutes}m` });
    return { accessToken, expiresIn: TOKENS.accessMinutes * 60, refreshToken, refreshExpiresAt };
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private audit(action: string, opts: { ctx: RequestContext; actorId?: string; after?: Record<string, unknown> }) {
    return this.prisma.auditLog.create({
      data: {
        action,
        actorId: opts.actorId,
        entityType: 'user',
        entityId: opts.actorId,
        after: opts.after as object | undefined,
        ip: opts.ctx.ip,
        userAgent: opts.ctx.userAgent?.slice(0, 255),
      },
    });
  }
}
