import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  accountDeleteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorLoginSchema,
  twoFactorSetupSchema,
  twoFactorCodeSchema,
  type AccountDeleteInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from '@ledgernest/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import {
  AuthService,
  type IssuedTokens,
  type RequestContext,
} from './auth.service.js';
import { CurrentActor, Public } from '../access/decorators.js';
import type { Actor } from '../access/types.js';
import { clearRefreshCookie, setRefreshCookie } from './session-cookie.js';
import { AccountService } from './account.service.js';
import { PasswordService } from './password.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { SessionsService } from './sessions.service.js';
import { z } from 'zod';
import { hashToken, REFRESH_COOKIE } from './tokens.js';

// Read on each request, not at import time: .env is loaded after this file is imported.
// The value itself is validated at startup in config/env.ts.
const loginLimit = () => Number(process.env.LOGIN_RATE_LIMIT ?? 10);
const resetLimit = () => Number(process.env.PASSWORD_RESET_RATE_LIMIT ?? 5);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly accounts: AccountService,
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: loginLimit } })
  @ApiBody({
    schema: {
      properties: { email: { type: 'string' }, password: { type: 'string' } },
      required: ['email', 'password'],
    },
  })
  @ApiOkResponse({
    description:
      'Signed in. Returns an access token; the refresh token is set as an httpOnly cookie.',
  })
  @ApiUnauthorizedResponse({ description: 'Email or password is incorrect' })
  @ApiTooManyRequestsResponse({
    description: 'Too many attempts from this address',
  })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(body.email, body.password, ctxOf(req));
    // Two-factor sign-in on: the password was right, now the code
    if ('ticket' in r) return { twoFactorRequired: true, ticket: r.ticket };
    this.setRefreshCookie(res, r);
    return { accessToken: r.accessToken, expiresIn: r.expiresIn };
  }

  @Post('login/2fa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: loginLimit } })
  @ApiOkResponse({
    description:
      'Signed in with the code from the authenticator app (or a recovery code) after the password',
  })
  async loginTwoFactor(
    @Body(new ZodValidationPipe(twoFactorLoginSchema))
    body: z.output<typeof twoFactorLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.loginTwoFactor(
      body.ticket,
      body.code,
      ctxOf(req),
    );
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Get('2fa')
  @ApiBearerAuth()
  @ApiOkResponse({
    description:
      'Whether two-factor sign-in is on, and how many recovery codes are left',
  })
  twoFactorStatus(@CurrentActor() actor: Actor) {
    return this.twoFactor.status(actor.userId);
  }

  @Post('2fa/setup')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({
    description:
      'A new secret and otpauth link to scan; a code from it turns two-factor on',
  })
  twoFactorSetup(
    @Body(new ZodValidationPipe(twoFactorSetupSchema))
    body: { password: string },
    @CurrentActor() actor: Actor,
  ) {
    return this.twoFactor.setup(actor.userId, body.password);
  }

  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({
    description:
      'Two-factor sign-in is on; the ten recovery codes are shown this once',
  })
  twoFactorEnable(
    @Body(new ZodValidationPipe(twoFactorEnableSchema)) body: { code: string },
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.twoFactor.enable(actor.userId, body.code, ctxOf(req));
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({ description: 'Two-factor sign-in is off' })
  async twoFactorDisable(
    @Body(new ZodValidationPipe(twoFactorDisableSchema))
    body: z.output<typeof twoFactorDisableSchema>,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    await this.twoFactor.disable(
      actor.userId,
      body.password,
      body.code,
      ctxOf(req),
    );
  }

  @Post('2fa/recovery-codes')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({
    description: 'Ten new recovery codes; the old ones stop working',
  })
  twoFactorRecoveryCodes(
    @Body(new ZodValidationPipe(z.object({ code: twoFactorCodeSchema })))
    body: { code: string },
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.twoFactor.regenerate(actor.userId, body.code, ctxOf(req));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  // Every page load refreshes, and a shared office connection has many people behind it
  @Throttle({ default: { ttl: 60_000, limit: 240 } })
  @ApiOkResponse({
    description: 'New access token; the refresh cookie is rotated',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
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
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(cookieOf(req), ctxOf(req));
    this.clearRefreshCookie(res);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: resetLimit } })
  @ApiOkResponse({
    description:
      'A reset link goes to the address if it has an account; the answer is the same either way',
  })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema))
    body: ForgotPasswordInput,
    @Req() req: Request,
  ) {
    await this.passwords.forgot(body.email, ctxOf(req));
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({
    description:
      'New password set from a reset link; every device is signed out',
  })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.passwords.reset(body.token, body.password, ctxOf(req));
    this.clearRefreshCookie(res);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({
    description: 'Password changed; other devices are signed out',
  })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    const raw = cookieOf(req);
    await this.passwords.change(
      actor.userId,
      body.currentPassword,
      body.newPassword,
      { ...ctxOf(req), refreshTokenHash: raw ? hashToken(raw) : undefined },
    );
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOkResponse({
    description:
      'Where you are signed in: device, address and when it was last used; this one first',
  })
  listSessions(@CurrentActor() actor: Actor, @Req() req: Request) {
    return this.sessions.list(actor.userId, cookieOf(req));
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOkResponse({
    description:
      'That device is signed out (within the access token’s 15 minutes)',
  })
  async revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    await this.sessions.revoke(actor.userId, id, ctxOf(req));
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Every device is signed out, this one included',
  })
  async logoutAll(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.passwords.signOutEverywhere(actor.userId, ctxOf(req));
    this.clearRefreshCookie(res);
    return r;
  }

  @Post('delete-account')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOkResponse({
    description:
      'The account is erased (name and email removed, sign-in disabled) and signed out everywhere',
  })
  async deleteAccount(
    @Body(new ZodValidationPipe(accountDeleteSchema)) body: AccountDeleteInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.accounts.remove(actor.userId, body.password, ctxOf(req));
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'The signed-in user, their organisations and permissions',
  })
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor.userId);
  }
  private setRefreshCookie(res: Response, tokens: IssuedTokens) {
    setRefreshCookie(res, this.config, tokens);
  }

  private clearRefreshCookie(res: Response) {
    clearRefreshCookie(res, this.config);
  }
}

const ctxOf = (req: Request): RequestContext => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});
const cookieOf = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
