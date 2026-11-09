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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { recurringSchema, upcomingQuerySchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RecurringService } from './recurring.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const body = new ZodValidationPipe(recurringSchema);
type Input = z.output<typeof recurringSchema>;

/** Recurring invoices. Reading needs invoices.view; changing schedules and running them needs invoices.manage. */
@ApiTags('recurring-invoices')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('recurring-invoices')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Every schedule, active first, with its next date and latest invoices',
  })
  list(@CurrentTenant() tenant: Tenant) {
    return this.recurring.list(tenant.organizationId);
  }

  @Get('upcoming')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'What active schedules will raise in the next days (default 30)',
  })
  upcoming(
    @Query(new ZodValidationPipe(upcomingQuerySchema)) q: { days: number },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.recurring.upcoming(tenant.organizationId, q.days);
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  get(@Param('id', id) scheduleId: string, @CurrentTenant() tenant: Tenant) {
    return this.recurring.get(tenant.organizationId, scheduleId);
  }

  @Post()
  @RequirePermission('invoices.manage')
  create(
    @Body(body) input: Input,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.create(input, { actor, tenant, req });
  }

  @Put(':id')
  @RequirePermission('invoices.manage')
  update(
    @Param('id', id) scheduleId: string,
    @Body(body) input: Input,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.update(scheduleId, input, { actor, tenant, req });
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  pause(
    @Param('id', id) scheduleId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.setPaused(scheduleId, true, { actor, tenant, req });
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  resume(
    @Param('id', id) scheduleId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.setPaused(scheduleId, false, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('invoices.manage')
  async remove(
    @Param('id', id) scheduleId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.recurring.remove(scheduleId, { actor, tenant, req });
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Raises everything due up to today now, rather than waiting for the hourly run',
  })
  run(
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.run(tenant.organizationId, { actor, tenant, req });
  }
}
