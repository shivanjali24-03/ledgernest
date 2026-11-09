import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ReportsController } from './reports.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ExportAuditInterceptor } from './export-audit.interceptor.js';
import { GstReturnsService } from './gst-returns.service.js';
import { ReportsService } from './reports.service.js';
import { StatementsService } from './statements.service.js';

@Module({
  imports: [MailModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    DashboardService,
    GstReturnsService,
    StatementsService,
    ExportAuditInterceptor,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
