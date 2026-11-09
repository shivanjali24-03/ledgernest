import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { DashboardService } from './dashboard.service.js';
import { GstReturnsService } from './gst-returns.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, DashboardService, GstReturnsService],
  exports: [ReportsService],
})
export class ReportsModule {}
