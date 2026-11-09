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
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  billDraftSchema,
  billListQuerySchema,
  billVoidSchema,
  type BillDraftInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillsService } from './bills.service.js';

const id = new ParseUUIDPipe({ version: '4' });
type Draft = Parameters<BillsService['createDraft']>[0];

/** Purchase bills. Reading needs bills.view; drafts, recording and voiding need bills.manage. */
@ApiTags('bills')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description:
      'Bills newest first, filtered by state (draft, open, partly_paid, paid, overdue, void, unpaid), vendor or text; with what is owed and overdue',
  })
  list(
    @Query(new ZodValidationPipe(billListQuerySchema))
    q: z.output<typeof billListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.bills.list(tenant.organizationId, q);
  }

  @Get(':id')
  @RequirePermission('bills.view')
  get(@Param('id', id) billId: string, @CurrentTenant() tenant: Tenant) {
    return this.bills.get(tenant.organizationId, billId);
  }

  @Post()
  @RequirePermission('bills.manage')
  create(
    @Body(new ZodValidationPipe(billDraftSchema)) body: BillDraftInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.bills.createDraft(body as Draft, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('bills.manage')
  update(
    @Param('id', id) billId: string,
    @Body(new ZodValidationPipe(billDraftSchema)) body: BillDraftInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.bills.updateDraft(billId, body as Draft, {
      actor,
      tenant,
      req,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('bills.manage')
  async remove(
    @Param('id', id) billId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.bills.deleteDraft(billId, { actor, tenant, req });
  }

  @Post(':id/record')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description: 'The bill with its number and the journal entry it posted',
  })
  record(
    @Param('id', id) billId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.bills.record(billId, { actor, tenant, req });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bills.manage')
  void(
    @Param('id', id) billId: string,
    @Body(new ZodValidationPipe(billVoidSchema))
    body: z.output<typeof billVoidSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.bills.void(billId, body, { actor, tenant, req });
  }
}
