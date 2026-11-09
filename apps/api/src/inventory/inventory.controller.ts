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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  stockAdjustmentSchema,
  stockValuationQuerySchema,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InventoryService } from './inventory.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Stock: what's on hand and what it's worth, each item's movements, and adjustments. */
@ApiTags('inventory')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('valuation')
  @RequirePermission('reports.view')
  @ApiOkResponse({
    description:
      'Each tracked item’s quantity, average cost and value on a day, beside the inventory accounts',
  })
  valuation(
    @Query(new ZodValidationPipe(stockValuationQuerySchema))
    q: { asOf?: string },
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.inventory.valuation(tenant.organizationId, q.asOf);
  }

  @Get('items/:id/movements')
  @RequirePermission('invoices.view')
  movements(@Param('id', id) itemId: string, @CurrentTenant() tenant: Tenant) {
    return this.inventory.movements(tenant.organizationId, itemId);
  }

  @Post('adjustments')
  @RequirePermission('journals.post')
  adjust(
    @Body(new ZodValidationPipe(stockAdjustmentSchema))
    body: z.output<typeof stockAdjustmentSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.inventory.adjust(body, { actor, tenant, req });
  }

  @Delete('adjustments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.post')
  async undo(
    @Param('id', id) movementId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.inventory.undoAdjustment(movementId, { actor, tenant, req });
  }
}
