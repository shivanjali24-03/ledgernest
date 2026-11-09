import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, type PipeTransform } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { accountCreateSchema, accountUpdateSchema, INDUSTRIES, type AccountUpdateInput, type Industry } from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AccountsService } from './accounts.service.js';

const id = new ParseUUIDPipe({ version: '4' });
const industry: PipeTransform<string, Industry> = {
  transform: (v) => {
    if (!(INDUSTRIES as readonly string[]).includes(v)) throw new NotFoundException('No template for that industry.');
    return v as Industry;
  },
};

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

  /** An industry's chart of accounts as it would be created here, named in the organisation's language. */
  @Get('templates/:industry')
  @RequirePermission('accounts.view')
  @ApiOkResponse({ description: 'The template accounts, parents first' })
  preview(@Param('industry', industry) ind: Industry, @CurrentTenant() tenant: Tenant) {
    return this.accounts.previewTemplate(tenant.organizationId, ind);
  }

  /** Creates the template's accounts. Only for a chart that holds nothing but the system accounts. */
  @Post('templates/:industry/apply')
  @RequirePermission('accounts.manage')
  applyTemplate(@Param('industry', industry) ind: Industry, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.accounts.applyTemplateFor(ind, { actor, tenant, req });
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
