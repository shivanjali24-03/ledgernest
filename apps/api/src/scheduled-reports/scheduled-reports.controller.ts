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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  scheduledReportSchema,
  scheduledReportUpdateSchema,
} from '@ledgernest/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ScheduledReportsService } from './scheduled-reports.service.js';

const id = new ParseUUIDPipe({ version: '4' });
type Input = z.output<typeof scheduledReportSchema>;

/** Scheduled reports: seeing and downloading them needs reports.view; setting them up needs reports.export. */
@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly schedules: ScheduledReportsService) {}

  @Get()
  @RequirePermission('reports.view')
  list(@CurrentTenant() tenant: Tenant) {
    return this.schedules.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('reports.export')
  create(
    @Body(new ZodValidationPipe(scheduledReportSchema)) body: Input,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.schedules.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('reports.export')
  update(
    @Param('id', id) scheduleId: string,
    @Body(new ZodValidationPipe(scheduledReportUpdateSchema))
    body: Partial<Input>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.schedules.update(scheduleId, body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('reports.export')
  async remove(
    @Param('id', id) scheduleId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.schedules.remove(scheduleId, { actor, tenant, req });
  }

  /** Runs it now for the period just ended (and emails it, when email is set up) */
  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('reports.export')
  run(
    @Param('id', id) scheduleId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.schedules.runNow(scheduleId, { actor, tenant, req });
  }

  @Get(':id/deliveries')
  @RequirePermission('reports.view')
  deliveries(
    @Param('id', id) scheduleId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.schedules.deliveries(tenant.organizationId, scheduleId);
  }

  @Get('deliveries/:id/file')
  @RequirePermission('reports.view')
  async file(
    @Param('id', id) deliveryId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = await this.schedules.file(tenant.organizationId, deliveryId);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Buffer.from(d.data), {
      type: d.contentType,
      disposition: `attachment; filename="${encodeURIComponent(d.fileName)}"`,
      length: d.data.length,
    });
  }
}
