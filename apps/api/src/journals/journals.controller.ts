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
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  attachmentUploadSchema,
  isoDaySchema,
  journalDraftSchema,
  journalReverseSchema,
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
import { JournalsService } from './journals.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const listQuery = z.object({
  status: z.enum(['draft', 'posted']).optional(),
  from: isoDaySchema.optional(),
  to: isoDaySchema.optional(),
  accountId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Journal entries. Reading needs journals.view; drafts need journals.create; posting and reversing have their own permissions. */
@ApiTags('journals')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('journals')
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @Get()
  @RequirePermission('journals.view')
  @ApiOkResponse({ description: 'Entries newest first, with totals' })
  list(
    @Query(new ZodValidationPipe(listQuery)) q: z.output<typeof listQuery>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.journals.list(tenant.organizationId, q);
  }

  @Get(':id')
  @RequirePermission('journals.view')
  get(@Param('id', id) entryId: string, @CurrentTenant() tenant: Tenant) {
    return this.journals.get(tenant.organizationId, entryId);
  }

  @Post()
  @RequirePermission('journals.create')
  create(
    @Body(new ZodValidationPipe(journalDraftSchema))
    body: z.output<typeof journalDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.journals.createDraft(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('journals.create')
  update(
    @Param('id', id) entryId: string,
    @Body(new ZodValidationPipe(journalDraftSchema))
    body: z.output<typeof journalDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.journals.updateDraft(entryId, body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.create')
  @ApiNoContentResponse()
  async remove(
    @Param('id', id) entryId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.journals.deleteDraft(entryId, { actor, tenant, req });
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('journals.post')
  post(
    @Param('id', id) entryId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.journals.post(entryId, { actor, tenant, req });
  }

  @Post(':id/reverse')
  @RequirePermission('journals.reverse')
  reverse(
    @Param('id', id) entryId: string,
    @Body(new ZodValidationPipe(journalReverseSchema))
    body: z.output<typeof journalReverseSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.journals.reverse(entryId, body, { actor, tenant, req });
  }

  /** Attach a PDF or image (base64, up to 2 MB), checked by its bytes. */
  @Post(':id/attachments')
  @RequirePermission('journals.create')
  attach(
    @Param('id', id) entryId: string,
    @Body(new ZodValidationPipe(attachmentUploadSchema))
    body: { fileName: string; type: AttachmentType; data: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.journals.attach(entryId, body, { actor, tenant, req });
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermission('journals.view')
  async download(
    @Param('id', id) entryId: string,
    @Param('attachmentId', id) attachmentId: string,
    @CurrentTenant() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const a = await this.journals.attachment(
      tenant.organizationId,
      entryId,
      attachmentId,
    );
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Buffer.from(a.data), {
      type: a.contentType,
      disposition: `attachment; filename="${encodeURIComponent(a.fileName)}"`,
      length: a.data.length,
    });
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.create')
  async detach(
    @Param('id', id) entryId: string,
    @Param('attachmentId', id) attachmentId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.journals.detach(entryId, attachmentId, { actor, tenant, req });
  }
}
