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
  billDraftSchema,
  billListQuerySchema,
  billVoidSchema,
  type BillDraftInput,
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
import { BillsService } from './bills.service.js';
import { SelfInvoicePdfService } from './self-invoice-pdf.service.js';

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
  constructor(
    private readonly bills: BillsService,
    private readonly selfInvoices: SelfInvoicePdfService,
  ) {}

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

  @Get('export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async exportCsv(
    @Query(new ZodValidationPipe(billListQuerySchema))
    q: z.output<typeof billListQuerySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { page: _p, pageSize: _s, ...filters } = q;
    res.setHeader('Content-Disposition', `attachment; filename="bills.csv"`);
    return this.bills.exportCsv(tenant.organizationId, filters, {
      actor,
      tenant,
      req,
    });
  }

  @Get(':id')
  @RequirePermission('bills.view')
  get(@Param('id', id) billId: string, @CurrentTenant() tenant: Tenant) {
    return this.bills.get(tenant.organizationId, billId);
  }

  /** The self-invoice raised for a purchase under reverse charge from an unregistered supplier, as a PDF */
  @Get(':id/self-invoice')
  @RequirePermission('bills.view')
  @ApiProduces('application/pdf')
  async selfInvoice(
    @Param('id', id) billId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.selfInvoices.download(tenant.organizationId, billId);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
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
    @Body(
      new ZodValidationPipe(
        z.object({ allowDuplicate: z.boolean().optional() }).optional(),
      ),
    )
    body: { allowDuplicate?: boolean } | undefined,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.bills.record(
      billId,
      { actor, tenant, req },
      { allowDuplicate: body?.allowDuplicate === true },
    );
  }

  /** Other bills from the same vendor that may be this one entered twice */
  @Get(':id/duplicates')
  @RequirePermission('bills.view')
  duplicates(@Param('id', id) billId: string, @CurrentTenant() tenant: Tenant) {
    return this.bills.duplicates(tenant.organizationId, billId);
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
