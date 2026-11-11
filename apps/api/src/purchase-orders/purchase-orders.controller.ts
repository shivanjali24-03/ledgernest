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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  goodsReceiptSchema,
  purchaseOrderDraftSchema,
  purchaseOrderListQuerySchema,
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
import { PurchaseOrdersService } from './purchase-orders.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const moveSchema = z.object({
  status: z.enum(['issued', 'cancelled', 'closed']),
});

/** Purchase orders and goods receipt notes. Reading needs bills.view; everything else bills.manage. */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('bills.view')
  list(
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema))
    q: z.output<typeof purchaseOrderListQuerySchema>,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.orders.list(tenant.organizationId, q);
  }

  @Get(':id')
  @RequirePermission('bills.view')
  get(@Param('id', id) orderId: string, @CurrentTenant() tenant: Tenant) {
    return this.orders.get(tenant.organizationId, orderId);
  }

  @Post()
  @RequirePermission('bills.manage')
  create(
    @Body(new ZodValidationPipe(purchaseOrderDraftSchema))
    body: z.output<typeof purchaseOrderDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('bills.manage')
  update(
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(purchaseOrderDraftSchema))
    body: z.output<typeof purchaseOrderDraftSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.update(orderId, body, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('bills.manage')
  @ApiNoContentResponse()
  async remove(
    @Param('id', id) orderId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    await this.orders.remove(orderId, { actor, tenant, req });
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description: 'Issues, cancels (before anything came) or closes the order',
  })
  move(
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(moveSchema)) body: z.output<typeof moveSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.move(orderId, body.status, { actor, tenant, req });
  }

  @Post(':id/receipts')
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description:
      'Records a goods receipt note: what came on each line, up to what was ordered',
  })
  receive(
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(goodsReceiptSchema))
    body: z.output<typeof goodsReceiptSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.receive(orderId, body, { actor, tenant, req });
  }

  @Post(':id/bill')
  @RequirePermission('bills.manage')
  @ApiOkResponse({
    description:
      'Makes a draft bill for what came and isn’t billed yet, at the order’s prices',
  })
  bill(
    @Param('id', id) orderId: string,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.orders.bill(orderId, { actor, tenant, req });
  }
}
