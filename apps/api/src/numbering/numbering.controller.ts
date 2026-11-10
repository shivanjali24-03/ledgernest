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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  numberSeriesSchema,
  numberSeriesUpdateSchema,
  type NumberSeriesUpdate,
  type NumberSeriesValues,
} from '@ledgernest/shared';
import type { Request } from 'express';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NumberingService } from './numbering.service.js';

/** Number series for invoices, credit notes and debit notes. Anyone who can see invoices sees them (to choose one); changes need org.settings.manage. */
@ApiTags('number-series')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('number-series')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  // Whoever drafts invoices chooses from them
  @RequirePermission('invoices.view')
  list(@CurrentTenant() tenant: Tenant) {
    return this.numbering.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('org.settings.manage')
  create(
    @Body(new ZodValidationPipe(numberSeriesSchema)) body: NumberSeriesValues,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.numbering.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('org.settings.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(numberSeriesUpdateSchema))
    body: NumberSeriesUpdate,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.numbering.update(id, body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.settings.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.numbering.remove(id, { actor, tenant, req });
  }
}
