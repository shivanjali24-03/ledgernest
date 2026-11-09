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
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoiceVoidSchema,
  type InvoiceDraftInput,
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
import { InvoicesService } from './invoices.service.js';

const id = new ParseUUIDPipe({ version: '4' });
type Draft = Parameters<InvoicesService['createDraft']>[0];

/** Sales invoices. Reading needs invoices.view; drafts, issuing and voiding need invoices.manage. */
@ApiTags('invoices')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Invoices newest first, filtered by state (draft, issued, partly_paid, paid, overdue, void, unpaid), customer, dates or text; with what is outstanding and overdue',
  })
  list(
    @Query(new ZodValidationPipe(invoiceListQuerySchema))
    q: z.output<typeof invoiceListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.invoices.list(tenant.organizationId, q);
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  get(@Param('id', id) invoiceId: string, @CurrentTenant() tenant: Tenant) {
    return this.invoices.get(tenant.organizationId, invoiceId);
  }

  @Post()
  @RequirePermission('invoices.manage')
  create(
    @Body(new ZodValidationPipe(invoiceDraftSchema)) body: InvoiceDraftInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.invoices.createDraft(body as Draft, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('invoices.manage')
  update(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(invoiceDraftSchema)) body: InvoiceDraftInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.invoices.updateDraft(invoiceId, body as Draft, {
      actor,
      tenant,
      req,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('invoices.manage')
  async remove(
    @Param('id', id) invoiceId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.invoices.deleteDraft(invoiceId, { actor, tenant, req });
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description: 'The invoice with its number and the journal entry it posted',
  })
  issue(
    @Param('id', id) invoiceId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.invoices.issue(invoiceId, { actor, tenant, req });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  void(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(invoiceVoidSchema))
    body: z.output<typeof invoiceVoidSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.invoices.void(invoiceId, body, { actor, tenant, req });
  }
}
