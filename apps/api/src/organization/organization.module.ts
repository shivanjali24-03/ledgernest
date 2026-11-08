import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { TeamController } from '../team/team.controller.js';
import { TeamService } from '../team/team.service.js';
import { OrganizationController } from './organization.controller.js';

@Module({ imports: [InvitationsModule], controllers: [OrganizationController, TeamController], providers: [TeamService] })
export class OrganizationModule {}
