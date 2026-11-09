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
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  ATTACHABLE_DOCUMENTS,
  attachmentUploadSchema,
  type AttachableDocument,
  type AttachmentType,
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
import { AttachmentsService } from './attachments.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const doc = new ZodValidationPipe(z.enum(ATTACHABLE_DOCUMENTS));

/**
 * Attachments on invoices, bills, payments and bank transactions. Any member reaches these routes; the service
 * checks the document's own view or manage permission.
 */
@ApiTags('attachments')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('attachments/:documentType/:documentId')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @RequirePermission('org.settings.view')
  list(
    @Param('documentType', doc) documentType: AttachableDocument,
    @Param('documentId', id) documentId: string,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.attachments.list(tenant, documentType, documentId);
  }

  /** A PDF or image (base64, up to 2 MB), checked by its bytes */
  @Post()
  @RequirePermission('org.settings.view')
  add(
    @Param('documentType', doc) documentType: AttachableDocument,
    @Param('documentId', id) documentId: string,
    @Body(new ZodValidationPipe(attachmentUploadSchema))
    body: { fileName: string; type: AttachmentType; data: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.attachments.add(documentType, documentId, body, {
      actor,
      tenant,
      req,
    });
  }

  /** The file: ?inline=true to show it in the browser (a preview), otherwise a download */
  @Get(':attachmentId')
  @RequirePermission('org.settings.view')
  async file(
    @Param('documentType', doc) documentType: AttachableDocument,
    @Param('documentId', id) documentId: string,
    @Param('attachmentId', id) attachmentId: string,
    @Query('inline') inline: string | undefined,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const a = await this.attachments.file(
      tenant,
      documentType,
      documentId,
      attachmentId,
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Buffer.from(a.data), {
      type: a.contentType,
      disposition: `${inline === 'true' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(a.fileName)}"`,
      length: a.data.length,
    });
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.settings.view')
  async remove(
    @Param('documentType', doc) documentType: AttachableDocument,
    @Param('documentId', id) documentId: string,
    @Param('attachmentId', id) attachmentId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.attachments.remove(documentType, documentId, attachmentId, {
      actor,
      tenant,
      req,
    });
  }
}
