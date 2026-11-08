import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  listQuerySchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  reasonSchema,
  type OrganizationCreateInput,
  type OrganizationUpdateInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, RequirePermission } from '../access/decorators.js';
import type { Actor } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PlatformService } from './platform.service.js';

const status = z.enum(['ACTIVE', 'SUSPENDED']).optional();
const orgListQuery = listQuerySchema.extend({ status });
const userListQuery = listQuerySchema.extend({
  status,
  superAdmin: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
const id = new ParseUUIDPipe({ version: '4' });

/** The Super Admin console. Every change is audited. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('stats')
  @RequirePermission('platform.organizations.view')
  @ApiOkResponse({ description: 'Organisation and user counts, recent sign-ins and recent platform activity' })
  stats() {
    return this.platform.stats();
  }

  // ---------- organisations ----------

  @Get('organizations')
  @RequirePermission('platform.organizations.view')
  @ApiQuery({ name: 'search', required: false, description: 'Matches name or web address' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'SUSPENDED'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  listOrganizations(@Query(new ZodValidationPipe(orgListQuery)) q: z.infer<typeof orgListQuery>) {
    return this.platform.listOrganizations(q);
  }

  @Get('organizations/:id')
  @RequirePermission('platform.organizations.view')
  @ApiOkResponse({ description: 'Details, owners and pending invitations' })
  getOrganization(@Param('id', id) orgId: string) {
    return this.platform.getOrganization(orgId);
  }

  @Post('organizations')
  @RequirePermission('platform.organizations.manage')
  @ApiOkResponse({ description: 'The new organisation, and whether the owner was added or invited (with a one-time link)' })
  createOrganization(@Body(new ZodValidationPipe(organizationCreateSchema)) body: OrganizationCreateInput, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.createOrganization(body as Parameters<PlatformService['createOrganization']>[0], actor, req);
  }

  @Patch('organizations/:id')
  @RequirePermission('platform.organizations.manage')
  updateOrganization(
    @Param('id', id) orgId: string,
    @Body(new ZodValidationPipe(organizationUpdateSchema)) body: OrganizationUpdateInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ) {
    return this.platform.updateOrganization(orgId, body, actor, req);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.organizations.manage')
  suspendOrganization(@Param('id', id) orgId: string, @Body(new ZodValidationPipe(reasonSchema)) body: { reason?: string }, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setOrganizationStatus(orgId, 'SUSPENDED', body.reason, actor, req);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.organizations.manage')
  reactivateOrganization(@Param('id', id) orgId: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setOrganizationStatus(orgId, 'ACTIVE', undefined, actor, req);
  }

  // ---------- users ----------

  @Get('users')
  @RequirePermission('platform.users.view')
  @ApiQuery({ name: 'search', required: false, description: 'Matches name or email' })
  @ApiQuery({ name: 'superAdmin', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'SUSPENDED'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  listUsers(@Query(new ZodValidationPipe(userListQuery)) q: z.infer<typeof userListQuery>) {
    return this.platform.listUsers(q);
  }

  @Post('users/:id/promote')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.users.manage')
  promote(@Param('id', id) userId: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setSuperAdmin(userId, true, actor, req);
  }

  @Post('users/:id/demote')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.users.manage')
  demote(@Param('id', id) userId: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setSuperAdmin(userId, false, actor, req);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.users.manage')
  suspendUser(@Param('id', id) userId: string, @Body(new ZodValidationPipe(reasonSchema)) body: { reason?: string }, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setUserStatus(userId, 'SUSPENDED', body.reason, actor, req);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.users.manage')
  reactivateUser(@Param('id', id) userId: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.platform.setUserStatus(userId, 'ACTIVE', undefined, actor, req);
  }
}
