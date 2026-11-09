import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { BankingController } from './banking.controller.js';
import { BankingService } from './banking.service.js';

@Module({
  imports: [JournalsModule, ReportsModule],
  controllers: [BankingController],
  providers: [BankingService],
  exports: [BankingService],
})
export class BankingModule {}
