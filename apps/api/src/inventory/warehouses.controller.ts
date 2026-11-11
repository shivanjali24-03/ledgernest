import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  stockTransferSchema,
  warehouseSchema,
  warehouseUpdateSchema,
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
import { WarehousesService } from './warehouses.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Warehouses (godowns, shops, branches) and goods moved between them */
@ApiTags('inventory')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller()
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get('warehouses')
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description: 'Every warehouse with how many items it holds and their value',
  })
  list(@CurrentTenant() tenant: Tenant) {
    return this.warehouses.list(tenant.organizationId);
  }

  @Post('warehouses')
  @RequirePermission('org.settings.manage')
  @ApiOkResponse({
    description:
      'A new warehouse; the first one made brings a main warehouse that takes the stock there was',
  })
  create(
    @Body(new ZodValidationPipe(warehouseSchema))
    body: z.output<typeof warehouseSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.warehouses.create(body, { actor, tenant, req });
  }

  @Patch('warehouses/:id')
  @RequirePermission('org.settings.manage')
  update(
    @Param('id', id) warehouseId: string,
    @Body(new ZodValidationPipe(warehouseUpdateSchema))
    body: z.output<typeof warehouseUpdateSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.warehouses.update(warehouseId, body, { actor, tenant, req });
  }

  @Post('warehouses/:id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('org.settings.manage')
  archive(
    @Param('id', id) warehouseId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.warehouses.archive(warehouseId, { actor, tenant, req });
  }

  @Get('warehouses/:id/stock')
  @RequirePermission('invoices.view')
  stock(@Param('id', id) warehouseId: string, @CurrentTenant() tenant: Tenant) {
    return this.warehouses.stock(tenant.organizationId, warehouseId);
  }

  @Get('inventory/transfers')
  @RequirePermission('invoices.view')
  transfers(@CurrentTenant() tenant: Tenant) {
    return this.warehouses.transfers(tenant.organizationId);
  }

  @Post('inventory/transfers')
  @RequirePermission('invoices.manage')
  @ApiOkResponse({
    description:
      'Goods moved from one warehouse to another at what they cost there; no entry',
  })
  transfer(
    @Body(new ZodValidationPipe(stockTransferSchema))
    body: z.output<typeof stockTransferSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.warehouses.transfer(body, { actor, tenant, req });
  }
}
