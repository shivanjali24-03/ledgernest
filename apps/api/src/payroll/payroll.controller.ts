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
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  employeeSchema,
  payRunPaySchema,
  payRunSchema,
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
import { PayrollService } from './payroll.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Employees, monthly pay runs and payslips. Salaries are private: payroll.view to see them, payroll.manage to run them. */
@ApiTags('payroll')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('employees')
  @RequirePermission('payroll.view')
  employees(@CurrentTenant() tenant: Tenant) {
    return this.payroll.employees(tenant.organizationId);
  }

  @Post('employees')
  @RequirePermission('payroll.manage')
  createEmployee(
    @Body(new ZodValidationPipe(employeeSchema))
    body: z.output<typeof employeeSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.createEmployee(body, { actor, tenant, req });
  }

  @Put('employees/:id')
  @RequirePermission('payroll.manage')
  updateEmployee(
    @Param('id', id) employeeId: string,
    @Body(new ZodValidationPipe(employeeSchema))
    body: z.output<typeof employeeSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.updateEmployee(employeeId, body, {
      actor,
      tenant,
      req,
    });
  }

  @Post('employees/:id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('payroll.manage')
  archiveEmployee(
    @Param('id', id) employeeId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.archiveEmployee(employeeId, { actor, tenant, req });
  }

  @Get('runs')
  @RequirePermission('payroll.view')
  runs(@CurrentTenant() tenant: Tenant) {
    return this.payroll.runs(tenant.organizationId);
  }

  @Get('runs/:id')
  @RequirePermission('payroll.view')
  run(@Param('id', id) runId: string, @CurrentTenant() tenant: Tenant) {
    return this.payroll.run(tenant.organizationId, runId);
  }

  @Post('runs')
  @RequirePermission('payroll.manage')
  createRun(
    @Body(new ZodValidationPipe(payRunSchema))
    body: z.output<typeof payRunSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.createRun(body, { actor, tenant, req });
  }

  @Delete('runs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('payroll.manage')
  removeRun(
    @Param('id', id) runId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.removeRun(runId, { actor, tenant, req });
  }

  @Post('runs/:id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  post(
    @Param('id', id) runId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.post(runId, { actor, tenant, req });
  }

  @Post('runs/:id/unpost')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  unpost(
    @Param('id', id) runId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.unpost(runId, { actor, tenant, req });
  }

  @Post('runs/:id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.manage')
  pay(
    @Param('id', id) runId: string,
    @Body(new ZodValidationPipe(payRunPaySchema))
    body: z.output<typeof payRunPaySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payroll.pay(runId, body, { actor, tenant, req });
  }

  @Get('payslips/:id/pdf')
  @RequirePermission('payroll.view')
  @ApiProduces('application/pdf')
  async payslip(
    @Param('id', id) payslipId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.payroll.payslipPdf(tenant.organizationId, payslipId);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.pdf.length,
    });
  }
}
