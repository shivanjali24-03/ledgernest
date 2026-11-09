import { createHash } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  API_KEY_PREFIX,
  type OrganizationPermission,
} from '@ledgernest/shared';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC } from './decorators.js';
import type { AccessRequest } from './types.js';

/**
 * Global: every endpoint requires a valid access token unless marked @Public().
 * The user is re-read from the database each time, so suspending an account or removing
 * Super Admin takes effect immediately, not when the 15-minute token runs out.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const req = context.switchToHttp().getRequest<AccessRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Please sign in.');
    if (token.startsWith(API_KEY_PREFIX)) return this.apiKey(req, token);

    let userId: string;
    try {
      userId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isSuperAdmin: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new UnauthorizedException('Please sign in again.');

    req.actor = {
      userId: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    };
    return true;
  }

  /** An organisation's API key: only its hash is stored. It stops working when revoked, expired, or its maker can't sign in. */
  private async apiKey(req: AccessRequest, token: string) {
    const hash = createHash('sha256').update(token).digest('hex');
    const key = await this.prisma.apiKey.findUnique({
      where: { hash },
      select: {
        id: true,
        name: true,
        prefix: true,
        organizationId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdBy: { select: { id: true, email: true, status: true } },
      },
    });
    if (
      !key ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt <= new Date()) ||
      key.createdBy.status !== 'ACTIVE'
    )
      throw new UnauthorizedException('This API key isn’t valid.');
    req.actor = {
      userId: key.createdBy.id,
      email: key.createdBy.email,
      isSuperAdmin: false,
      apiKey: {
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        organizationId: key.organizationId,
        scopes: new Set(key.scopes as OrganizationPermission[]),
      },
    };
    // When it was last used, to the minute
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000)
      await this.prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      });
    return true;
  }
}
