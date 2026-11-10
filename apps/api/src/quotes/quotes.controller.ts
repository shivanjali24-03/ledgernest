import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  quoteConvertSchema,
  quoteDraftSchema,
  quoteListQuerySchema,
  quoteStatusSchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { QuotesService } from './quotes.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Quotes for customers. Reading needs invoices.view; everything else needs invoices.manage. */
@ApiTags('quotes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Quotes newest first, filtered by state (draft, sent, accepted, declined, invoiced, expired, open), customer or text',
  })
  list(
    @Query(new ZodValidationPipe(quoteListQuerySchema))
    q: z.output<typeof quoteListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.quotes.list(tenant.organizationId, q);
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  get(@Param('id', id) quoteId: string, @CurrentTenant() tenant: Tenant) {
    return this.quotes.get(tenant.organizationId, quoteId);
  }

  @Post()
  @RequirePermission('invoices.manage')
  create(
    @Body(new ZodValidationPipe(quoteDraftSchema))
    body: z.output<typeof quoteDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.quotes.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('invoices.manage')
  update(
    @Param('id', id) quoteId: string,
    @Body(new ZodValidationPipe(quoteDraftSchema))
    body: z.output<typeof quoteDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.quotes.update(quoteId, body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('invoices.manage')
  async remove(
    @Param('id', id) quoteId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.quotes.remove(quoteId, { actor, tenant, req });
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description: 'Marks it sent, accepted or declined, or back to draft',
  })
  move(
    @Param('id', id) quoteId: string,
    @Body(new ZodValidationPipe(quoteStatusSchema))
    body: z.output<typeof quoteStatusSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.quotes.move(quoteId, body.status, { actor, tenant, req });
  }

  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Makes a draft invoice with the quote’s lines and marks the quote invoiced; returns both',
  })
  convert(
    @Param('id', id) quoteId: string,
    @Body(new ZodValidationPipe(quoteConvertSchema))
    body: z.output<typeof quoteConvertSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.quotes.convert(quoteId, body, { actor, tenant, req });
  }
}
