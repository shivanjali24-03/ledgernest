import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  itemCreateSchema,
  itemListQuerySchema,
  itemUpdateSchema,
  type ItemCreateInput,
  type ItemUpdateInput,
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
import { ItemsService } from './items.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** Products and services. Reading needs invoices.view; changes need invoices.manage. */
@ApiTags('items')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({
    description:
      'Items by name; filter by goods or services, search name, SKU or HSN/SAC',
  })
  list(
    @Query(new ZodValidationPipe(itemListQuerySchema))
    q: z.output<typeof itemListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.items.list(tenant.organizationId, q);
  }

  @Get('export')
  @RequirePermission('reports.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async exportCsv(
    @Query(new ZodValidationPipe(itemListQuerySchema))
    q: z.output<typeof itemListQuerySchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const filters = q;
    res.setHeader('Content-Disposition', `attachment; filename="items.csv"`);
    return this.items.exportCsv(tenant.organizationId, filters, {
      actor,
      tenant,
      req,
    });
  }

  @Get('facets')
  @RequirePermission('invoices.view')
  @ApiOkResponse({ description: 'The categories and brands in use' })
  facets(@CurrentTenant() tenant: Tenant) {
    return this.items.facets(tenant.organizationId);
  }

  @Get(':id')
  @RequirePermission('invoices.view')
  get(@Param('id', id) itemId: string, @CurrentTenant() tenant: Tenant) {
    return this.items.get(tenant.organizationId, itemId);
  }

  @Post()
  @RequirePermission('invoices.manage')
  create(
    @Body(new ZodValidationPipe(itemCreateSchema)) body: ItemCreateInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.items.create(body as Parameters<ItemsService['create']>[0], {
      actor,
      tenant,
      req,
    });
  }

  @Patch(':id')
  @RequirePermission('invoices.manage')
  update(
    @Param('id', id) itemId: string,
    @Body(new ZodValidationPipe(itemUpdateSchema)) body: ItemUpdateInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.items.update(itemId, body, { actor, tenant, req });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  archive(
    @Param('id', id) itemId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.items.archive(itemId, true, { actor, tenant, req });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('invoices.manage')
  restore(
    @Param('id', id) itemId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.items.archive(itemId, false, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('invoices.manage')
  async remove(
    @Param('id', id) itemId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.items.remove(itemId, { actor, tenant, req });
  }
}
