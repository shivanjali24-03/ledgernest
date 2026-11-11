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
import { InterestModule } from './interest/interest.module.js';
import { NumberingModule } from './numbering/numbering.module.js';
import { GeoModule } from './geo/geo.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { ItemsModule } from './items/items.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { BillsModule } from './bills/bills.module.js';
import { VendorCreditsModule } from './vendor-credits/vendor-credits.module.js';
import { CreditNotesModule } from './credit-notes/credit-notes.module.js';
import { RecurringModule } from './recurring/recurring.module.js';
import { BankingModule } from './banking/banking.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { BudgetsModule } from './budgets/budgets.module.js';
import { CostCentresModule } from './cost-centres/cost-centres.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { ScheduledReportsModule } from './scheduled-reports/scheduled-reports.module.js';
import { HousekeepingModule } from './housekeeping/housekeeping.module.js';
import { BackupsModule } from './backups/backups.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

import { PdfFontsModule } from './pdf-fonts/pdf-fonts.module.js';
@Module({
  imports: [
    PdfFontsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
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
    GeoModule,
    NumberingModule,
    InterestModule,
    ContactsModule,
    ItemsModule,
    InvoicesModule,
    QuotesModule,
    PurchaseOrdersModule,
    PaymentsModule,
    BillsModule,
    CreditNotesModule,
    VendorCreditsModule,
    RecurringModule,
    BankingModule,
    AssetsModule,
    BudgetsModule,
    CostCentresModule,
    InventoryModule,
    ApprovalsModule,
    AttachmentsModule,
    ImportsModule,
    IntegrationsModule,
    ScheduledReportsModule,
    HousekeepingModule,
    BackupsModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
