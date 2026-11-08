import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loginSchema, type LoginInput } from '@ledgernest/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { AuthService, type IssuedTokens, type RequestContext } from './auth.service.js';
import { CurrentUser, JwtAuthGuard } from './jwt-auth.guard.js';
import { REFRESH_COOKIE } from './tokens.js';
import type { AccessPayload } from './auth.service.js';

// Read on each request, not at import time: .env is loaded after this file is imported.
// The value itself is validated at startup in config/env.ts.
const loginLimit = () => Number(process.env.LOGIN_RATE_LIMIT ?? 10);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: loginLimit } })
  @ApiBody({ schema: { properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } })
  @ApiOkResponse({ description: 'Signed in. Returns an access token; the refresh token is set as an httpOnly cookie.' })
  @ApiUnauthorizedResponse({ description: 'Email or password is incorrect' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this address' })
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(body.email, body.password, ctxOf(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOkResponse({ description: 'New access token; the refresh cookie is rotated' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const tokens = await this.auth.refresh(cookieOf(req), ctxOf(req));
      this.setRefreshCookie(res, tokens);
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
    } catch (e) {
      this.clearRefreshCookie(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(cookieOf(req), ctxOf(req));
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'The signed-in user, their organisations and permissions' })
  me(@CurrentUser() user: AccessPayload) {
    return this.auth.me(user.sub);
  }

  // The refresh cookie is httpOnly (JavaScript can't read it) and only sent to /api/v1/auth
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('COOKIE_SAMESITE', { infer: true }),
      path: '/api/v1/auth',
    } as const;
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...this.cookieOptions(), expires: tokens.refreshExpiresAt });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }
}

const ctxOf = (req: Request): RequestContext => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const cookieOf = (req: Request): string | undefined => (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
