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
  budgetCreateSchema,
  budgetLinesSchema,
  budgetRenameSchema,
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
import { BudgetsService } from './budgets.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Budgets. Reading needs reports.view; making and changing them needs accounts.manage. */
@ApiTags('budgets')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @RequirePermission('reports.view')
  list(@CurrentTenant() tenant: Tenant) {
    return this.budgets.list(tenant.organizationId);
  }

  @Get(':id')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'The budget as a grid: accounts down, the year’s twelve months across',
  })
  get(@Param('id', id) budgetId: string, @CurrentTenant() tenant: Tenant) {
    return this.budgets.get(tenant.organizationId, budgetId);
  }

  @Get(':id/comparison')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Budget against actual for the year, or up to a day, with variances',
  })
  comparison(
    @Param('id', id) budgetId: string,
    @Query(new ZodValidationPipe(z.object({ upTo: isoDaySchema.optional() })))
    q: { upTo?: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.budgets.comparison(tenant.organizationId, budgetId, q.upTo);
  }

  @Post()
  @RequirePermission('accounts.manage')
  create(
    @Body(new ZodValidationPipe(budgetCreateSchema))
    body: z.output<typeof budgetCreateSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.budgets.create(body, { actor, tenant, req });
  }

  @Put(':id/lines')
  @RequirePermission('accounts.manage')
  setLines(
    @Param('id', id) budgetId: string,
    @Body(new ZodValidationPipe(budgetLinesSchema))
    body: z.output<typeof budgetLinesSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.budgets.setLines(budgetId, body.lines, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('accounts.manage')
  rename(
    @Param('id', id) budgetId: string,
    @Body(new ZodValidationPipe(budgetRenameSchema)) body: { name: string },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.budgets.rename(budgetId, body.name, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('accounts.manage')
  async remove(
    @Param('id', id) budgetId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.budgets.remove(budgetId, { actor, tenant, req });
  }
}
