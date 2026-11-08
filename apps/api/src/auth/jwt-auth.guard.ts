import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessPayload } from './auth.service.js';

type AuthedRequest = Request & { user?: AccessPayload };

/** Requires a valid `Authorization: Bearer <access token>` header. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Please sign in.');
    try {
      req.user = await this.jwt.verifyAsync<AccessPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
  }
}

/** Injects the verified token payload into a controller method. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessPayload => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException('Please sign in.');
  return user;
});
