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
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
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
  isoDaySchema,
  ewayTransportSchema,
  einvoiceIrnSchema,
  type EwayTransport,
  interestRaiseSchema,
  invoiceCopyQuerySchema,
  type InvoiceCopy,
  interestWaiverSchema,
  todayIn,
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
import { EinvoiceService } from './einvoice.service.js';
import { InvoiceShareService } from './invoice-share.service.js';
import { InvoicesService } from './invoices.service.js';
import { InterestChargesService } from './interest-charges.service.js';

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
    private readonly sharing: InvoiceShareService,
    private readonly einvoices: EinvoiceService,
    private readonly interestCharges: InterestChargesService,
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

  /** GST e-invoice JSON for every issued invoice to a registered buyer in the dates, and those needing a fix */
  @Get('e-invoice')
  @RequirePermission('invoices.view')
  eInvoices(
    @Query(
      new ZodValidationPipe(
        z
          .object({ from: isoDaySchema, to: isoDaySchema })
          .refine((v) => v.from <= v.to, {
            path: ['to'],
            message: 'The start comes after the end.',
          }),
      ),
    )
    q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.einvoices.range(tenant.organizationId, q.from, q.to);
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

  /** One issued invoice as GST e-invoice JSON for the Invoice Registration Portal */
  @Get(':id/e-invoice')
  @RequirePermission('invoices.view')
  @ApiProduces('application/json')
  async eInvoice(
    @Param('id', id) invoiceId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.einvoices.one(tenant.organizationId, invoiceId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${f.fileName}"`,
    );
    return f.json;
  }

  /** Records the IRN the e-invoice portal gave, to print with its signed QR code */
  @Put(':id/irn')
  @RequirePermission('invoices.manage')
  async setIrn(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(einvoiceIrnSchema))
    body: z.output<typeof einvoiceIrnSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
  ) {
    await this.einvoices.setIrn(
      tenant.organizationId,
      invoiceId,
      body,
      actor.userId,
    );
    return this.invoices.get(tenant.organizationId, invoiceId);
  }

  @Delete(':id/irn')
  @RequirePermission('invoices.manage')
  async clearIrn(
    @Param('id', id) invoiceId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
  ) {
    await this.einvoices.clearIrn(
      tenant.organizationId,
      invoiceId,
      actor.userId,
    );
    return this.invoices.get(tenant.organizationId, invoiceId);
  }

  /** One issued invoice's goods as e-way bill JSON for the portal's bulk upload, with the transport details given */
  @Post(':id/e-way-bill')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.view')
  @ApiProduces('application/json')
  async ewayBill(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(ewayTransportSchema)) body: EwayTransport,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.einvoices.ewayBill(
      tenant.organizationId,
      invoiceId,
      body,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${f.fileName}"`,
    );
    return f.json;
  }

  @Get(':id/pdf')
  @RequirePermission('invoices.view')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) invoiceId: string,
    @Query(new ZodValidationPipe(invoiceCopyQuerySchema))
    q: { copy?: InvoiceCopy },
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.reminders.download(
      tenant.organizationId,
      invoiceId,
      q.copy,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  /** A link the customer opens without signing in; the same link each time until it is turned off */
  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  share(
    @Param('id', id) invoiceId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.sharing.share(invoiceId, { actor, tenant, req });
  }

  @Delete(':id/share')
  @RequirePermission('invoices.manage')
  unshare(
    @Param('id', id) invoiceId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.sharing.unshare(invoiceId, { actor, tenant, req });
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

  @Post('interest/raise')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Draft interest invoices for every invoice with interest on late payment left to charge, to a day (default today)',
  })
  async raiseAllInterest(
    @Body(new ZodValidationPipe(interestRaiseSchema)) body: { asOf?: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    const asOf =
      body.asOf ??
      todayIn(
        (await this.invoices.timeZone(tenant.organizationId)) ?? 'Asia/Kolkata',
      );
    return this.interestCharges.raiseAll(tenant.organizationId, asOf, {
      actor,
      tenant,
      req,
    });
  }

  @Get(':id/interest')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Interest on late payment on the invoice: accrued to today, invoiced already, waived, left to charge',
  })
  async interestStatus(
    @Param('id', id) invoiceId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    await this.invoices.get(tenant.organizationId, invoiceId);
    return this.interestCharges.status(
      tenant.organizationId,
      invoiceId,
      todayIn(
        (await this.invoices.timeZone(tenant.organizationId)) ?? 'Asia/Kolkata',
      ),
    );
  }

  @Post(':id/interest/raise')
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'A draft invoice for the interest left to charge on this one, with GST at its supply’s rates',
  })
  raiseInterest(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(interestRaiseSchema)) body: { asOf?: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.interestCharges.raise(invoiceId, body.asOf, {
      actor,
      tenant,
      req,
    });
  }

  @Post(':id/interest/waive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Lets the customer off interest on this invoice, with the reason',
  })
  waiveInterest(
    @Param('id', id) invoiceId: string,
    @Body(new ZodValidationPipe(interestWaiverSchema))
    body: z.output<typeof interestWaiverSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.interestCharges.waive(invoiceId, body, { actor, tenant, req });
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
