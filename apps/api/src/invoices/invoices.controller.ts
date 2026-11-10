import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoiceEmailSchema,
  invoiceReminderSchema,
  invoiceVoidSchema,
  type InvoiceDraftInput,
} from '@ledgernest/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
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
  constructor(
    private readonly invoices: InvoicesService,
    private readonly reminders: InvoiceRemindersService,
  ) {}

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

  @Post('remind-overdue')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      "Emails a payment reminder for each of a customer's overdue invoices; says how many went and which didn't",
  })
  remindOverdue(
    @Body(new ZodValidationPipe(z.object({ contactId: z.uuid() })))
    body: { contactId: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.reminders.remindOverdue(body.contactId, {
      actor,
      tenant,
      req,
    });
  }

  @Get('export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async exportCsv(
    @Query(new ZodValidationPipe(invoiceListQuerySchema))
    q: z.output<typeof invoiceListQuerySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { page: _p, pageSize: _s, ...filters } = q;
    res.setHeader('Content-Disposition', `attachment; filename="invoices.csv"`);
    return this.invoices.exportCsv(tenant.organizationId, filters, {
      actor,
      tenant,
      req,
    });
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

  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Emails the customer a payment reminder for what’s still owed; 409 when nothing is owed or email isn’t set up',
  })
  remind(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(invoiceReminderSchema))
    body: z.output<typeof invoiceReminderSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.reminders.remind(invoiceId, body, { actor, tenant, req });
  }

  @Post(':id/email')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Emails an issued invoice as a PDF to the customer, or to the address given',
  })
  email(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(invoiceEmailSchema))
    body: z.output<typeof invoiceEmailSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.reminders.emailInvoice(invoiceId, body, {
      actor,
      tenant,
      req,
    });
  }
}
