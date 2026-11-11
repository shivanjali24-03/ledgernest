import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { gstRegistrationSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GstRegistrationsService } from './gst-registrations.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const updateSchema = gstRegistrationSchema
  .pick({ tradeName: true, address: true })
  .partial();

/** The organisation's GST registrations in other states (its own GSTIN is in Settings) */
@ApiTags('taxes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('gst-registrations')
export class GstRegistrationsController {
  constructor(private readonly registrations: GstRegistrationsService) {}

  @Get()
  @RequirePermission('invoices.view')
  list(@CurrentTenant() tenant: Tenant) {
    return this.registrations.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('taxes.manage')
  create(
    @Body(new ZodValidationPipe(gstRegistrationSchema))
    body: z.output<typeof gstRegistrationSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.registrations.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('taxes.manage')
  update(
    @Param('id', id) registrationId: string,
    @Body(new ZodValidationPipe(updateSchema))
    body: z.output<typeof updateSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.registrations.update(registrationId, body, {
      actor,
      tenant,
      req,
    });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('taxes.manage')
  archive(
    @Param('id', id) registrationId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.registrations.archive(registrationId, { actor, tenant, req });
  }
}
