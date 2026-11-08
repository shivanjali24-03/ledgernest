import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<AccessRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Please sign in.');

    let userId: string;
    try {
      userId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isSuperAdmin: true, status: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Please sign in again.');

    req.actor = { userId: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin };
    return true;
  }
}
