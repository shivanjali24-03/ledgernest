import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from './access/access.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { PeriodsModule } from './periods/periods.module.js';
import { JournalsModule } from './journals/journals.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TaxesModule } from './taxes/taxes.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    // Default limit: 120 requests per minute per client; sensitive routes (login) set stricter limits
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    AccessModule,
    AuditModule,
    InvitationsModule,
    OrganizationModule,
    AccountsModule,
    PeriodsModule,
    JournalsModule,
    ReportsModule,
    TaxesModule,
    CurrenciesModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
