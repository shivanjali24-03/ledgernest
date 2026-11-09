import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { accountCreateSchema, accountUpdateSchema, type AccountUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AccountsService } from './accounts.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/** The chart of accounts. Reading needs accounts.view; every change needs accounts.manage and is audited. */
@ApiTags('accounts')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission('accounts.view')
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ description: 'Every account, ordered by code, with its parent, normal side and number of sub-accounts' })
  list(@Query('includeArchived') includeArchived?: string) {
    return this.accounts.list(includeArchived === 'true');
  }

  @Post()
  @RequirePermission('accounts.manage')
  create(
    @Body(new ZodValidationPipe(accountCreateSchema)) body: z.output<typeof accountCreateSchema>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.accounts.create(body, { actor, tenant, req });
  }

  @Patch(':id')
  @RequirePermission('accounts.manage')
  update(
    @Param('id', id) accountId: string,
    @Body(new ZodValidationPipe(accountUpdateSchema)) body: AccountUpdateInput,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.accounts.update(accountId, body, { actor, tenant, req });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('accounts.manage')
  archive(@Param('id', id) accountId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.accounts.archive(accountId, { actor, tenant, req });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('accounts.manage')
  restore(@Param('id', id) accountId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.accounts.restore(accountId, { actor, tenant, req });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('accounts.manage')
  @ApiNoContentResponse()
  async remove(@Param('id', id) accountId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.accounts.remove(accountId, { actor, tenant, req });
  }
}
