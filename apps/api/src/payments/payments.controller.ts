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
  invoiceEmailSchema,
  PAYMENT_KINDS,
  paymentVoidSchema,
  receiptSchema,
  vendorPaymentSchema,
  type ReceiptInput,
  type VendorPaymentInput,
  chequeOptionsSchema,
  type ChequeOptions,
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
import { PaymentReceiptsService } from './payment-receipts.service.js';
import { PaymentsService } from './payments.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const listQuery = z.object({
  kind: z.enum(PAYMENT_KINDS).optional(),
  contactId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Receipts and payments. Reading needs invoices.view; recording and voiding need payments.manage. */
@ApiTags('payments')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly receipts: PaymentReceiptsService,
  ) {}

  @Get()
  @RequirePermission('invoices.view')
  list(
    @Query(new ZodValidationPipe(listQuery)) q: z.output<typeof listQuery>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.payments.list(tenant.organizationId, q);
  }

  @Get('open-invoices/:contactId')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'The customer’s issued invoices with something left to pay, oldest due first',
  })
  openInvoices(
    @Param('contactId', id) contactId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.payments.openInvoices(tenant.organizationId, contactId);
  }

  @Get('open-bills/:contactId')
  @RequirePermission('bills.view')
  @ApiOkResponse({
    description:
      'The vendor’s recorded bills with something left to pay, oldest due first',
  })
  openBills(
    @Param('contactId', id) contactId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.payments.openBills(tenant.organizationId, contactId);
  }

  @Get(':id/pdf')
  @RequirePermission('invoices.view')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.receipts.download(tenant.organizationId, paymentId);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  /** A vendor payment as a PDF to print onto a cheque leaf (CTS-2010), nudged in millimetres for the printer */
  @Get(':id/cheque')
  @RequirePermission('bills.view')
  @ApiProduces('application/pdf')
  async cheque(
    @Param('id', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Query(new ZodValidationPipe(chequeOptionsSchema)) q: ChequeOptions,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.receipts.cheque(tenant.organizationId, paymentId, q);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `inline; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  get(@Param('id', id) paymentId: string, @CurrentTenant() tenant: Tenant) {
    return this.payments.get(tenant.organizationId, paymentId);
  }

  @Post('receipts')
  @RequirePermission('payments.manage')
  @ApiOkResponse({
    description: 'The receipt with its number, allocations and journal entry',
  })
  receive(
    @Body(new ZodValidationPipe(receiptSchema)) body: ReceiptInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payments.receive(
      body as Parameters<PaymentsService['receive']>[0],
      { actor, tenant, req },
    );
  }

  @Post('payments')
  @RequirePermission('payments.manage')
  @ApiOkResponse({
    description: 'The payment with its number, allocations and journal entry',
  })
  pay(
    @Body(new ZodValidationPipe(vendorPaymentSchema)) body: VendorPaymentInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payments.pay(body as Parameters<PaymentsService['pay']>[0], {
      actor,
      tenant,
      req,
    });
  }

  @Post(':id/email')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payments.manage')
  @ApiOkResponse({
    description:
      'Emails a posted receipt to the customer as a PDF: what came in and which invoices it settled',
  })
  email(
    @Param('id', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Body(new ZodValidationPipe(invoiceEmailSchema))
    body: z.output<typeof invoiceEmailSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.receipts.email(paymentId, body, { actor, tenant, req });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payments.manage')
  void(
    @Param('id', id) paymentId: string,
    @Body(new ZodValidationPipe(paymentVoidSchema)) body: { reason?: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.payments.void(paymentId, body, { actor, tenant, req });
  }
}
