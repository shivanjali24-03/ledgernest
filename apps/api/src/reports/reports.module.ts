import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ReportsController } from './reports.controller.js';
import { CashForecastService } from './cash-forecast.service.js';
import { GstHealthService } from './gst-health.service.js';
import { TallyExportService } from './tally-export.service.js';
import { MsmeReportService } from './msme-report.service.js';
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
  controllers: [ReportsController],
  providers: [
    CashForecastService,
    GstHealthService,
    TallyExportService,
    TdsReportService,
    MsmeReportService,
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
