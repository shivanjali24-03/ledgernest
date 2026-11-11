import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  gstSetupSchema,
  taxGroupCreateSchema,
  taxGroupUpdateSchema,
  taxRateCreateSchema,
  taxRateUpdateSchema,
  type GstSetupInput,
  type TaxGroupCreateInput,
  type TaxRateCreateInput,
  type TaxRateUpdateInput, gstCessSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TaxesService } from './taxes.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Tax rates and groups. Anyone who can read the books sees them (lines need them); changing them needs taxes.manage. */
@ApiTags('taxes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('taxes')
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get()
  @RequirePermission('accounts.view')
  @ApiOkResponse({ description: 'Rates, groups, and for Indian organisations the GST slabs and which are set up' })
  list(@CurrentTenant() tenant: Tenant) {
    return this.taxes.list(tenant.organizationId);
  }

  @Post('gst-setup')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  @ApiOkResponse({ description: 'What was created (accounts, rates, groups), then the full list' })
  setupGst(@Body(new ZodValidationPipe(gstSetupSchema)) body: GstSetupInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.setupGst(body.slabIds, { actor, tenant, req });
  }

  @Post('gst-cess')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  @ApiOkResponse({ description: 'Compensation cess added to a GST rate: the groups made, then the full list' })
  addCess(@Body(new ZodValidationPipe(gstCessSchema)) body: { gstRatePpm: number; cessRatePpm: number }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.addCess(body, { actor, tenant, req });
  }

  @Post('rates')
  @RequirePermission('taxes.manage')
  createRate(@Body(new ZodValidationPipe(taxRateCreateSchema)) body: TaxRateCreateInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.createRate(body as Parameters<TaxesService['createRate']>[0], { actor, tenant, req });
  }

  @Patch('rates/:id')
  @RequirePermission('taxes.manage')
  updateRate(@Param('id', id) rateId: string, @Body(new ZodValidationPipe(taxRateUpdateSchema)) body: TaxRateUpdateInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.updateRate(rateId, body, { actor, tenant, req });
  }

  @Post('rates/:id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  archiveRate(@Param('id', id) rateId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.archiveRate(rateId, true, { actor, tenant, req });
  }

  @Post('rates/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  restoreRate(@Param('id', id) rateId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.archiveRate(rateId, false, { actor, tenant, req });
  }

  @Post('groups')
  @RequirePermission('taxes.manage')
  createGroup(@Body(new ZodValidationPipe(taxGroupCreateSchema)) body: TaxGroupCreateInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.createGroup(body, { actor, tenant, req });
  }

  @Patch('groups/:id')
  @RequirePermission('taxes.manage')
  renameGroup(@Param('id', id) groupId: string, @Body(new ZodValidationPipe(taxGroupUpdateSchema)) body: { name: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.renameGroup(groupId, body.name, { actor, tenant, req });
  }

  @Post('groups/:id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  archiveGroup(@Param('id', id) groupId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.archiveGroup(groupId, true, { actor, tenant, req });
  }

  @Post('groups/:id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('taxes.manage')
  restoreGroup(@Param('id', id) groupId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.taxes.archiveGroup(groupId, false, { actor, tenant, req });
  }
}
