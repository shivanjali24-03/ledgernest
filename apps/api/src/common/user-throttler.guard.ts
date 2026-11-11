import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Rate limits per person, not per address. A signed-in request (a valid access token) is counted against
 * its user; anything else against the client's IP. An office where everyone shares one internet connection
 * would otherwise run out of requests together.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    const header: unknown = req.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      try {
        const { sub } = await this.jwt.verifyAsync<{ sub: string }>(
          header.slice(7),
        );
        if (sub) return `user:${sub}`;
      } catch {
        // Not a valid access token (an API key, or expired): count it by address
      }
    }
    return `ip:${String(req.ip ?? req.socket?.remoteAddress ?? '')}`;
  }
}
