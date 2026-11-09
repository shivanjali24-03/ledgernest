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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  depreciationRunSchema,
  disposeSchema,
  fixedAssetSchema,
  isoDaySchema,
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
import { AssetsService } from './assets.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const body = new ZodValidationPipe(fixedAssetSchema);
type AssetIn = z.output<typeof fixedAssetSchema>;

/** Fixed assets. Reading needs accounts.view; changing the register and charging depreciation need journals.post. */
@ApiTags('fixed-assets')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('fixed-assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermission('accounts.view')
  list(@CurrentTenant() tenant: Tenant) {
    return this.assets.list(tenant.organizationId);
  }

  @Get('schedule')
  @RequirePermission('accounts.view')
  @ApiOkResponse({
    description:
      'Cost and depreciation for each asset over a period: at the start, added, charged, disposed of, and at the end',
  })
  schedule(
    @Query(
      new ZodValidationPipe(z.object({ from: isoDaySchema, to: isoDaySchema })),
    )
    q: { from: string; to: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.assets.schedule(tenant.organizationId, q.from, q.to);
  }

  @Get('depreciation/preview')
  @RequirePermission('accounts.view')
  @ApiOkResponse({
    description: 'What a depreciation run up to a day would charge each asset',
  })
  preview(
    @Query(new ZodValidationPipe(depreciationRunSchema)) q: { upTo: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.assets.preview(tenant.organizationId, q.upTo);
  }

  @Get('depreciation/runs')
  @RequirePermission('accounts.view')
  runs(@CurrentTenant() tenant: Tenant) {
    return this.assets.runs(tenant.organizationId);
  }

  @Post('depreciation/runs')
  @RequirePermission('journals.post')
  run(
    @Body(new ZodValidationPipe(depreciationRunSchema)) q: { upTo: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.assets.run(q.upTo, { actor, tenant, req });
  }

  @Delete('depreciation/runs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.post')
  async undoRun(
    @Param('id', id) runId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.assets.undoRun(runId, { actor, tenant, req });
  }

  @Get(':id')
  @RequirePermission('accounts.view')
  get(@Param('id', id) assetId: string, @CurrentTenant() tenant: Tenant) {
    return this.assets.get(tenant.organizationId, assetId);
  }

  @Post()
  @RequirePermission('journals.post')
  create(
    @Body(body) input: AssetIn,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.assets.create(input, { actor, tenant, req });
  }

  @Put(':id')
  @RequirePermission('journals.post')
  update(
    @Param('id', id) assetId: string,
    @Body(body) input: AssetIn,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.assets.update(assetId, input, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.post')
  async remove(
    @Param('id', id) assetId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.assets.remove(assetId, { actor, tenant, req });
  }

  @Post(':id/dispose')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('journals.post')
  dispose(
    @Param('id', id) assetId: string,
    @Body(new ZodValidationPipe(disposeSchema))
    input: z.output<typeof disposeSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.assets.dispose(assetId, input, { actor, tenant, req });
  }
}
