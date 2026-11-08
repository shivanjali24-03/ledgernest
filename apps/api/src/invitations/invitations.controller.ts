import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { acceptInvitationSchema, acceptInvitationSignedInSchema, type AcceptInvitationInput } from '@ledgernest/shared';
import { CurrentActor, Public } from '../access/decorators.js';
import type { Actor } from '../access/types.js';
import { sessionBody, setRefreshCookie } from '../auth/session-cookie.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { InvitationsService } from './invitations.service.js';

const tokenBody = { schema: { properties: { token: { type: 'string' } }, required: ['token'] } };

/** Tokens travel in request bodies, never URLs, so they don't end up in server logs. */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('preview')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiBody(tokenBody)
  @ApiOkResponse({ description: 'Organisation, email and role the invitation is for, and whether that email already has an account' })
  preview(@Body(new ZodValidationPipe(acceptInvitationSignedInSchema)) body: { token: string }) {
    return this.invitations.preview(body.token);
  }

  @Post('accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOkResponse({ description: 'Account created, joined and signed in. The refresh token is set as a cookie.' })
  async accept(@Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.invitations.acceptAsNewUser(body as Required<AcceptInvitationInput>, req);
    setRefreshCookie(res, this.config, tokens);
    return sessionBody(tokens);
  }

  @Post('accept-signed-in')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiBody(tokenBody)
  @ApiOkResponse({ description: 'Joined the organisation' })
  acceptSignedIn(@Body(new ZodValidationPipe(acceptInvitationSignedInSchema)) body: { token: string }, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.invitations.acceptAsSignedInUser(body.token, actor.userId, req);
  }
}
