import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  vendorCreditApplySchema,
  vendorCreditListQuerySchema,
  vendorCreditSchema,
  vendorCreditVoidSchema,
  vendorCreditRefundSchema,
  type VendorCreditApplyInput,
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
import { VendorCreditsService } from './vendor-credits.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Debit notes against recorded bills. Reading needs bills.view; raising, applying and voiding need bills.manage; refunds need payments.manage. */
@ApiTags('debit-notes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('debit-notes')
export class VendorCreditsController {
  constructor(private readonly notes: VendorCreditsService) {}

  @Get()
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description: 'Debit notes, newest first, optionally for one vendor or bill',
  })
  list(
    @Query(new ZodValidationPipe(vendorCreditListQuerySchema))
    q: z.output<typeof vendorCreditListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.notes.list(tenant.organizationId, q);
  }

  @Get('creditable/:billId')
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description:
      'How much of each of a bill’s lines can still be credited, and which are goods kept in stock',
  })
  creditable(
    @Param('billId', id) billId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.notes.creditable(tenant.organizationId, billId);
  }

  @Get(':id')
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description: 'The debit note with its lines, tax and where its credit went',
  })
  get(@Param('id', id) noteId: string, @CurrentTenant() tenant: Tenant) {
    return this.notes.get(tenant.organizationId, noteId);
  }

  @Post()
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description:
      'The debit note, applied to its bill as far as the bill was unpaid',
  })
  create(
    @Body(new ZodValidationPipe(vendorCreditSchema))
    body: z.output<typeof vendorCreditSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.create(body, { actor, tenant, req });
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description: 'The debit note, with some of its credit on another bill',
  })
  apply(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(vendorCreditApplySchema))
    body: VendorCreditApplyInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.apply(noteId, body, { actor, tenant, req });
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payments.manage')
  @ApiOkResponse({
    description:
      'The debit note, with some of its credit paid back by the vendor',
  })
  refund(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(vendorCreditRefundSchema))
    body: z.output<typeof vendorCreditRefundSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.refund(noteId, body, { actor, tenant, req });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bills.manage')
  @ApiOkResponse({ description: 'The voided debit note' })
  void(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(vendorCreditVoidSchema))
    body: z.output<typeof vendorCreditVoidSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.void(noteId, body, { actor, tenant, req });
  }
}
