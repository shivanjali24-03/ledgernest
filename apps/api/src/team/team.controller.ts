import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { changeMemberRoleSchema, customRoleSchema, customRoleUpdateSchema, inviteMemberSchema, type CustomRoleInput, type RoleChoice } from '@ledgernest/shared';
import type { Request } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TeamService } from './team.service.js';

const id = new ParseUUIDPipe({ version: '4' });

/**
 * An organisation's own team: members, invitations and custom roles.
 * Every change checks that the caller isn't granting more access than they have, and is audited.
 */
@ApiTags('team')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('organization')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  // ---------- members ----------

  @Get('members')
  @RequirePermission('users.view')
  @ApiOkResponse({ description: 'Members with their roles' })
  members() {
    return this.team.listMembers();
  }

  @Patch('members/:id')
  @RequirePermission('users.manage')
  changeRole(
    @Param('id', id) memberId: string,
    @Body(new ZodValidationPipe(changeMemberRoleSchema)) body: { role: RoleChoice },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.team.changeMemberRole(memberId, body.role, { actor, tenant, req });
  }

  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('users.manage')
  async remove(@Param('id', id) memberId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.team.removeMember(memberId, { actor, tenant, req });
  }

  // ---------- invitations ----------

  @Get('invitations')
  @RequirePermission('users.view')
  @ApiOkResponse({ description: 'Invitations not yet accepted or revoked, including expired ones' })
  invitations() {
    return this.team.listInvitations();
  }

  @Post('invitations')
  @RequirePermission('users.invite')
  @ApiOkResponse({ description: 'The invitation, with its one-time link' })
  invite(
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: { email: string; role: RoleChoice },
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.team.invite(body.email, body.role, { actor, tenant, req });
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users.invite')
  @ApiOkResponse({ description: 'A new link with a fresh 7-day window; the old link stops working' })
  resend(@Param('id', id) invitationId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.team.resendInvitation(invitationId, { actor, tenant, req });
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('users.invite')
  async revoke(@Param('id', id) invitationId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.team.revokeInvitation(invitationId, { actor, tenant, req });
  }

  // ---------- roles ----------

  @Get('roles')
  @RequirePermission('roles.view')
  @ApiOkResponse({ description: 'Built-in roles (read-only) and custom roles, with member counts and whether you can assign each' })
  roles(@CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.team.listRoles({ actor, tenant, req });
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(@Body(new ZodValidationPipe(customRoleSchema)) body: CustomRoleInput, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    return this.team.createRole(body as Parameters<TeamService['createRole']>[0], { actor, tenant, req });
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  updateRole(
    @Param('id', id) roleId: string,
    @Body(new ZodValidationPipe(customRoleUpdateSchema)) body: Partial<CustomRoleInput>,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.team.updateRole(roleId, body, { actor, tenant, req });
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('roles.manage')
  async deleteRole(@Param('id', id) roleId: string, @CurrentActor() actor: Actor, @CurrentTenant() tenant: Tenant, @Req() req: Request) {
    await this.team.deleteRole(roleId, { actor, tenant, req });
  }
}
