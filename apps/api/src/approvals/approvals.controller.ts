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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  APPROVAL_DOCUMENTS,
  approvalDecisionSchema,
  approvalListQuerySchema,
  approvalRejectSchema,
  approvalRuleSchema,
  type ApprovalDocument,
  type ApprovalStatus,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApprovalsService } from './approvals.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const docPipe = new ZodValidationPipe(z.enum(APPROVAL_DOCUMENTS));

/** Approval rules (approvals.manage) and the requests they hold (approvals.approve). */
@ApiTags('approvals')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('rules')
  @RequirePermission('journals.view')
  rules(@CurrentTenant() tenant: Tenant) {
    return this.approvals.rules(tenant.organizationId);
  }

  @Put('rules/:documentType')
  @RequirePermission('approvals.manage')
  setRule(
    @Param('documentType', docPipe) documentType: ApprovalDocument,
    @Body(new ZodValidationPipe(approvalRuleSchema))
    body: { minAmount: number },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.approvals.setRule(documentType, body.minAmount, {
      actor,
      tenant,
      req,
    });
  }

  @Delete('rules/:documentType')
  @RequirePermission('approvals.manage')
  removeRule(
    @Param('documentType', docPipe) documentType: ApprovalDocument,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.approvals.removeRule(documentType, { actor, tenant, req });
  }

  @Get()
  @RequirePermission('approvals.approve')
  list(
    @Query(new ZodValidationPipe(approvalListQuerySchema))
    q: { status?: ApprovalStatus },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.approvals.list(tenant.organizationId, q.status);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('approvals.approve')
  approve(
    @Param('id', id) requestId: string,
    @Body(new ZodValidationPipe(approvalDecisionSchema))
    body: { note?: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.approvals.approve(requestId, body.note ?? null, {
      actor,
      tenant,
      req,
    });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('approvals.approve')
  reject(
    @Param('id', id) requestId: string,
    @Body(new ZodValidationPipe(approvalRejectSchema)) body: { note: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.approvals.reject(requestId, body.note, { actor, tenant, req });
  }

  /** Withdrawn by whoever sent it */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.view')
  async cancel(
    @Param('id', id) requestId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.approvals.cancel(requestId, { actor, tenant, req });
  }
}
