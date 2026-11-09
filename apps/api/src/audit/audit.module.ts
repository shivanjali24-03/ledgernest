import { Global, Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service.js';
import {
  OrganizationAuditController,
  PlatformAuditController,
} from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [OrganizationAuditController, PlatformAuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
