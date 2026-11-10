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
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { recurringBillSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RecurringBillsService } from './recurring-bills.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const body = new ZodValidationPipe(recurringBillSchema);
type Input = z.output<typeof recurringBillSchema>;

/** Recurring invoices. Reading needs invoices.view; changing schedules and running them needs invoices.manage. */
@ApiTags('recurring-bills')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('recurring-bills')
export class RecurringBillsController {
  constructor(private readonly recurring: RecurringBillsService) {}

  @Get()
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description:
      'Every schedule of bills, active first, with its next date and latest bills',
  })
  list(@CurrentTenant() tenant: Tenant) {
    return this.recurring.list(tenant.organizationId);
  }

  @Get(':id')
  @RequirePermission('bills.view')
  get(@Param('id', id) scheduleId: string, @CurrentTenant() tenant: Tenant) {
    return this.recurring.get(tenant.organizationId, scheduleId);
  }

  @Post()
  @RequirePermission('bills.manage')
  create(
    @Body(body) input: Input,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.create(input, { actor, tenant, req });
  }

  @Put(':id')
  @RequirePermission('bills.manage')
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
  @RequirePermission('bills.manage')
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
  @RequirePermission('bills.manage')
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
  @RequirePermission('bills.manage')
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
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description:
      'Makes every bill due up to today now, rather than waiting for the hourly run',
  })
  run(
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.recurring.run(tenant.organizationId, { actor, tenant, req });
  }
}
