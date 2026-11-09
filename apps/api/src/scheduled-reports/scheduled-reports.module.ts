import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { ScheduledReportsController } from './scheduled-reports.controller.js';
import { ScheduledReportsService } from './scheduled-reports.service.js';

@Module({
  imports: [ReportsModule, MailModule],
  controllers: [ScheduledReportsController],
  providers: [ScheduledReportsService],
})
export class ScheduledReportsModule {}
