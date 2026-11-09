import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IMPORT_KINDS,
  importRequestSchema,
  type ImportKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ImportsService } from './imports.service.js';

const kindPipe = new ZodValidationPipe(z.enum(IMPORT_KINDS));
type Body = z.output<typeof importRequestSchema>;

/** Spreadsheet imports. Each kind needs the permission adding one by hand does (checked by the service). */
@ApiTags('imports')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('imports/:kind')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org.settings.view')
  @ApiOkResponse({
    description: 'Every row checked as if imported; nothing is saved',
  })
  preview(
    @Param('kind', kindPipe) kind: ImportKind,
    @Body(new ZodValidationPipe(importRequestSchema)) body: Body,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.imports.run(
      kind,
      body.rows,
      { actor, tenant, req },
      { commit: false, date: body.date },
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org.settings.view')
  @ApiOkResponse({
    description:
      'Saved only if every row is right (saved: true); otherwise the rows with their problems',
  })
  run(
    @Param('kind', kindPipe) kind: ImportKind,
    @Body(new ZodValidationPipe(importRequestSchema)) body: Body,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.imports.run(
      kind,
      body.rows,
      { actor, tenant, req },
      { commit: true, date: body.date },
    );
  }
}
