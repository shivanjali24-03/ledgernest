import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ReportsController } from './reports.controller.js';
import {
  BalanceConfirmationsController,
  PublicConfirmationsController,
} from './balance-confirmations.controller.js';
import { BalanceConfirmationsService } from './balance-confirmations.service.js';
import { CashForecastService } from './cash-forecast.service.js';
import { GstHealthService } from './gst-health.service.js';
import { TallyExportService } from './tally-export.service.js';
import { MsmeReportService } from './msme-report.service.js';
import { Itc180Service } from './itc-180.service.js';
import { TdsReportService } from './tds-report.service.js';
import { DashboardService } from './dashboard.service.js';
import { ExportAuditInterceptor } from './export-audit.interceptor.js';
import { GstReturnsService } from './gst-returns.service.js';
import { ReportsService } from './reports.service.js';
import { SalesReportService } from './sales-report.service.js';
import { StatementsService } from './statements.service.js';
import { WeeklySummaryService } from './weekly-summary.service.js';

@Module({
  imports: [MailModule],
  controllers: [
    ReportsController,
    BalanceConfirmationsController,
    PublicConfirmationsController,
  ],
  providers: [
    CashForecastService,
    GstHealthService,
    TallyExportService,
    TdsReportService,
    MsmeReportService,
    Itc180Service,
    BalanceConfirmationsService,
    ReportsService,
    DashboardService,
    GstReturnsService,
    StatementsService,
    SalesReportService,
    WeeklySummaryService,
    ExportAuditInterceptor,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
