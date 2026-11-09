import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service.js';
import { AuthGuard } from './auth.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { TenantPrisma } from './tenant-prisma.js';

/** Authentication and authorisation for every endpoint: AuthGuard runs first, then PermissionGuard. */
@Global()
@Module({
  providers: [
    AccessService,
    TenantPrisma,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AccessService, TenantPrisma],
})
export class AccessModule {}
