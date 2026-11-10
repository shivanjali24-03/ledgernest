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
import { CustomerLinkService } from './customer-link.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** A customer's account link: made and turned off by people who manage invoices */
@ApiTags('contacts')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('contacts')
export class CustomerLinkController {
  constructor(private readonly links: CustomerLinkService) {}

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'The customer’s link (the same one each time until it’s turned off), and how often it was opened',
  })
  share(
    @Param('id', id) contactId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.links.share(contactId, { actor, tenant, req });
  }

  @Post(':id/chased')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Notes that the customer was chased for what’s overdue, and when',
  })
  chased(
    @Param('id', id) contactId: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          channel: z.enum(['whatsapp', 'phone']).default('whatsapp'),
        }),
      ),
    )
    body: { channel: 'whatsapp' | 'phone' },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.links.chased(contactId, body.channel, { actor, tenant, req });
  }

  @Delete(':id/share')
  @RequirePermission('invoices.manage')
  unshare(
    @Param('id', id) contactId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.links.unshare(contactId, { actor, tenant, req });
  }
}

/** A customer's account opened from their link, without signing in: rate-limited, never cached, not indexed */
@ApiTags('public')
@Public()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('public/customers')
export class PublicCustomerController {
  constructor(private readonly links: CustomerLinkService) {}

  @Get(':token')
  view(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.links.view(token);
  }

  @Get(':token/invoices/:invoiceId/pdf')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('token') token: string,
    @Param('invoiceId', id) invoiceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.links.pdf(token, invoiceId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }
}
