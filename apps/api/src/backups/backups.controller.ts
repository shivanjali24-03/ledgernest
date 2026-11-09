import { Body, Controller, Get, Header, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { backupRestoreSchema, type BackupFile } from '@ledgernest/shared';
import type { Request, Response } from 'express';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BackupsService } from './backups.service.js';

/** Backups, for Owners only (org.delete is the Owner's alone among the built-in roles). */
@ApiTags('organization')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('export')
  @RequirePermission('org.delete')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'The whole organisation as one JSON file' })
  async export(
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const b = await this.backups.export({ actor, tenant, req });
    const slug =
      b.source.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'organisation';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slug}-backup-${b.exportedAt.slice(0, 10)}.json"`,
    );
    return b;
  }

  /** Restores a backup as a new organisation owned by the caller, after checking it holds together */
  @Post('restore')
  @RequirePermission('org.delete')
  restore(
    @Body(new ZodValidationPipe(backupRestoreSchema))
    body: { name?: string; backup: BackupFile },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.backups.restore(body.backup, body.name, { actor, tenant, req });
  }
}
