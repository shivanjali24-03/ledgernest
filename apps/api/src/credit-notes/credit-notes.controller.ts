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
  creditApplySchema,
  creditNoteListQuerySchema,
  creditNoteSchema,
  creditNoteVoidSchema,
  creditRefundSchema,
  type CreditApplyInput,
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
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import { CreditNotesService } from './credit-notes.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Credit notes against issued invoices. Reading needs invoices.view; issuing, applying and voiding need invoices.manage; refunds need payments.manage. */
@ApiTags('credit-notes')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('credit-notes')
export class CreditNotesController {
  constructor(
    private readonly notes: CreditNotesService,
    private readonly pdfs: CreditNotePdfService,
  ) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Credit notes, newest first, optionally for one customer or invoice',
  })
  list(
    @Query(new ZodValidationPipe(creditNoteListQuerySchema))
    q: z.output<typeof creditNoteListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.notes.list(tenant.organizationId, q);
  }

  @Get('creditable/:invoiceId')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description: 'How much of each of an invoice’s lines can still be credited',
  })
  creditable(
    @Param('invoiceId', id) invoiceId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.notes.creditable(tenant.organizationId, invoiceId);
  }

  /** The credit note as a PDF for the customer */
  @Get(':id/pdf')
  @RequirePermission('invoices.view')
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe({ version: '4' })) creditNoteId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.pdfs.download(tenant.organizationId, creditNoteId);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${f.fileName}"`,
      length: f.data.length,
    });
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'The credit note with its lines, tax and where its credit went',
  })
  get(@Param('id', id) noteId: string, @CurrentTenant() tenant: Tenant) {
    return this.notes.get(tenant.organizationId, noteId);
  }

  @Post()
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'The issued credit note, applied to its invoice as far as the invoice was unpaid',
  })
  create(
    @Body(new ZodValidationPipe(creditNoteSchema))
    body: z.output<typeof creditNoteSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.create(body, { actor, tenant, req });
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description: 'The credit note, with some of its credit on another invoice',
  })
  apply(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(creditApplySchema)) body: CreditApplyInput,
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
    description: 'The credit note, with some of its credit paid back',
  })
  refund(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(creditRefundSchema))
    body: z.output<typeof creditRefundSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.refund(noteId, body, { actor, tenant, req });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  @ApiOkResponse({ description: 'The voided credit note' })
  void(
    @Param('id', id) noteId: string,
    @Body(new ZodValidationPipe(creditNoteVoidSchema))
    body: z.output<typeof creditNoteVoidSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.notes.void(noteId, body, { actor, tenant, req });
  }
}
