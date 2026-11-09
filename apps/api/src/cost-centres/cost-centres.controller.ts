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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { costCentreSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CostCentresService } from './cost-centres.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const listQuery = z.object({
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** Cost centres and projects. Reading needs accounts.view; changing them needs accounts.manage. */
@ApiTags('cost-centres')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('cost-centres')
export class CostCentresController {
  constructor(private readonly costCentres: CostCentresService) {}

  @Get()
  @RequirePermission('accounts.view')
  list(
    @Query(new ZodValidationPipe(listQuery)) q: { archived: boolean },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.costCentres.list(tenant.organizationId, q.archived);
  }

  @Post()
  @RequirePermission('accounts.manage')
  create(
    @Body(new ZodValidationPipe(costCentreSchema))
    body: z.output<typeof costCentreSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.costCentres.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('accounts.manage')
  update(
    @Param('id', id) ccId: string,
    @Body(new ZodValidationPipe(costCentreSchema))
    body: z.output<typeof costCentreSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.costCentres.update(ccId, body, { actor, tenant, req });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('accounts.manage')
  archive(
    @Param('id', id) ccId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.costCentres.archive(ccId, true, { actor, tenant, req });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('accounts.manage')
  restore(
    @Param('id', id) ccId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.costCentres.archive(ccId, false, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('accounts.manage')
  async remove(
    @Param('id', id) ccId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.costCentres.remove(ccId, { actor, tenant, req });
  }
}
