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
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { webhookSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WebhooksService } from './webhooks.service.js';

const id = new ParseUUIDPipe({ version: '4' });
type Input = z.output<typeof webhookSchema>;

/**
 * Webhooks, for Owners and Admins (integrations.manage). Each request is a JSON POST signed with
 * X-LedgerNest-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body" with the endpoint's secret>.
 */
@ApiTags('integrations')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission('integrations.manage')
  list(@CurrentTenant() tenant: Tenant) {
    return this.webhooks.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('integrations.manage')
  @ApiOkResponse({ description: 'The endpoint with its signing secret' })
  create(
    @Body(new ZodValidationPipe(webhookSchema)) body: Input,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.webhooks.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('integrations.manage')
  update(
    @Param('id', id) endpointId: string,
    @Body(new ZodValidationPipe(webhookSchema.partial())) body: Partial<Input>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.webhooks.update(endpointId, body, { actor, tenant, req });
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('integrations.manage')
  rotate(
    @Param('id', id) endpointId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.webhooks.rotate(endpointId, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('integrations.manage')
  async remove(
    @Param('id', id) endpointId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.webhooks.remove(endpointId, { actor, tenant, req });
  }

  @Get(':id/deliveries')
  @RequirePermission('integrations.manage')
  deliveries(
    @Param('id', id) endpointId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.webhooks.deliveries(tenant.organizationId, endpointId);
  }

  @Post(':id/ping')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('integrations.manage')
  ping(
    @Param('id', id) endpointId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.webhooks.ping(endpointId, { actor, tenant, req });
  }

  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('integrations.manage')
  retry(
    @Param('id', id) deliveryId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.webhooks.retry(deliveryId, { actor, tenant, req });
  }
}
