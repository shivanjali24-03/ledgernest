import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { currencyAddSchema, currencyCodeSchema, isoDaySchema, rateFetchSchema, rateListQuerySchema, rateSetSchema, revalueSchema } from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurrenciesService } from './currencies.service.js';

const code = new ZodValidationPipe(currencyCodeSchema);
const day = new ZodValidationPipe(isoDaySchema);

/** Foreign currencies and exchange rates. Anyone who can read the books sees them; changes need currencies.manage. */
@ApiTags('currencies')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @RequirePermission('accounts.view')
  @ApiOkResponse({ description: 'The base currency and each enabled currency with its latest rate' })
  list(@CurrentTenant() tenant: Tenant) {
    return this.currencies.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('currencies.manage')
  add(@Body(new ZodValidationPipe(currencyAddSchema)) body: { code: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.currencies.add(body.code, { actor, tenant, req });
  }

  @Post('rates/fetch')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('currencies.manage')
  @ApiOkResponse({ description: 'Rates saved from the European Central Bank, currencies kept because a rate was typed by hand, and currencies it doesn’t cover' })
  fetch(@Body(new ZodValidationPipe(rateFetchSchema)) body: { date?: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.currencies.fetchRates(body.date, { actor, tenant, req });
  }

  @Post('revalue')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('currencies.manage')
  @ApiOkResponse({ description: 'Each foreign-currency account moved to the day’s rate, the entry that booked the differences, and currencies without a rate' })
  revalue(@Body(new ZodValidationPipe(revalueSchema)) body: { date: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.currencies.revalue(body.date, { actor, tenant, req });
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('currencies.manage')
  async remove(@Param('code', code) c: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.currencies.remove(c, { actor, tenant, req });
  }

  @Get(':code/rates')
  @RequirePermission('accounts.view')
  rates(@Param('code', code) c: string, @Query(new ZodValidationPipe(rateListQuerySchema)) q: { from?: string; to?: string }, @CurrentTenant() tenant: Tenant) {
    return this.currencies.rates(tenant.organizationId, c, q);
  }

  @Put(':code/rates/:date')
  @RequirePermission('currencies.manage')
  setRate(@Param('code', code) c: string, @Param('date', day) date: string, @Body(new ZodValidationPipe(rateSetSchema)) body: { rate: string }, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.currencies.setRate(c, date, body.rate, { actor, tenant, req });
  }

  @Delete(':code/rates/:date')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('currencies.manage')
  async removeRate(@Param('code', code) c: string, @Param('date', day) date: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.currencies.removeRate(c, date, { actor, tenant, req });
  }
}
