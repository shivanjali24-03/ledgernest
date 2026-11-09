import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, DashboardService],
  exports: [ReportsService],
})
export class ReportsModule {}
