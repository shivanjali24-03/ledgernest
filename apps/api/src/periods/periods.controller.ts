import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { fiscalYearCreateSchema, periodActionSchema, type FiscalYearCreateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PeriodsService } from './periods.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const reason = new ZodValidationPipe(periodActionSchema);

/** Financial years and periods. Anyone who can read the books sees them; closing and reopening need their own permissions. */
@ApiTags('periods')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('fiscal-years')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @RequirePermission('accounts.view')
  @ApiOkResponse({ description: 'Financial years, newest first, with their periods and which one can close or reopen next' })
  list(@CurrentTenant() tenant: Tenant) {
    return this.periods.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('periods.close')
  create(@Body(new ZodValidationPipe(fiscalYearCreateSchema)) body: FiscalYearCreateInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.periods.createYear(body.startYear, { actor, tenant, req });
  }

  @Post('periods/:id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('periods.close')
  async close(@Param('id', id) periodId: string, @Body(reason) body: { reason?: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.periods.close(periodId, body.reason, { actor, tenant, req });
  }

  @Post('periods/:id/reopen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('periods.reopen')
  async reopen(@Param('id', id) periodId: string, @Body(reason) body: { reason?: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.periods.reopen(periodId, body.reason, { actor, tenant, req });
  }
}
