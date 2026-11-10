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
import { quoteDecisionSchema } from '@ledgernest/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  Public,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { QuoteShareService } from './quote-share.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** A quote's customer link: made (which sends a draft) and turned off by people who manage invoices */
@ApiTags('quotes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('quotes')
export class QuoteShareController {
  constructor(private readonly links: QuoteShareService) {}

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'The quote with its link (the same each time until turned off); a draft becomes sent',
  })
  share(
    @Param('id', id) quoteId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.links.share(quoteId, { actor, tenant, req });
  }

  @Delete(':id/share')
  @RequirePermission('invoices.manage')
  unshare(
    @Param('id', id) quoteId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.links.unshare(quoteId, { actor, tenant, req });
  }
}

/** A quote opened from its link, without signing in: rate-limited, never cached, not indexed */
@ApiTags('public')
@Public()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/quotes')
export class PublicQuoteController {
  constructor(private readonly links: QuoteShareService) {}

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
    return this.links.view(token);
  }

  @Get(':token/pdf')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.links.pdf(token);
    this.headers(res);
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async decide(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(quoteDecisionSchema))
    body: z.output<typeof quoteDecisionSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.headers(res);
    return this.links.decide(token, body);
  }
}
