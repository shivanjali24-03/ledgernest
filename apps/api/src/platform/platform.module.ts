import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

@Module({ imports: [InvitationsModule], controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
