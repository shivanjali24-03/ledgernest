import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  balanceConfirmationRequestSchema,
  balanceConfirmationResponseSchema,
  CONFIRMATION_SIDES,
  isoDaySchema,
  type ConfirmationSide,
} from '@ledgernest/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  Public,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BalanceConfirmationsService } from './balance-confirmations.service.js';

/** Asking customers and vendors to confirm their balances, and seeing who has */
@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('balance-confirmations')
export class BalanceConfirmationsController {
  constructor(private readonly confirmations: BalanceConfirmationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contacts.manage')
  @ApiOkResponse({
    description:
      'Requests made (or reused) for everyone on that side with a balance on the day, emailed where possible',
  })
  request(
    @Body(new ZodValidationPipe(balanceConfirmationRequestSchema))
    body: z.output<typeof balanceConfirmationRequestSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.confirmations.request(body, { actor, tenant, req });
  }

  @Get()
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description: 'Each request for the day and side, with its answer',
  })
  list(
    @Query(
      new ZodValidationPipe(
        z.object({ asOf: isoDaySchema, side: z.enum(CONFIRMATION_SIDES) }),
      ),
    )
    q: { asOf: string; side: ConfirmationSide },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.confirmations.list(tenant.organizationId, q.asOf, q.side);
  }
}

/** The party's side, from their link: rate-limited, never cached, not indexed */
@ApiTags('public')
@Public()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/confirmations')
export class PublicConfirmationsController {
  constructor(private readonly confirmations: BalanceConfirmationsService) {}

  private headers(res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  @Get(':token')
  async view(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.headers(res);
    return this.confirmations.view(token);
  }

  @Get(':token/statement')
  @ApiProduces('application/pdf')
  async statement(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.confirmations.statementPdf(token);
    this.headers(res);
    return new StreamableFile(f.data, {
      type: f.contentType,
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async respond(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(balanceConfirmationResponseSchema))
    body: z.output<typeof balanceConfirmationResponseSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.headers(res);
    return this.confirmations.respond(token, body);
  }
}
