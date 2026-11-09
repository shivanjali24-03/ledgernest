import { Module } from '@nestjs/common';
import { ApprovalGateModule } from '../approvals/approval-gate.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { BankingController } from './banking.controller.js';
import { BankingService } from './banking.service.js';
import { ReconcileService } from './reconcile.service.js';
import { StatementsService } from './statements.service.js';

@Module({
  imports: [JournalsModule, ReportsModule, ApprovalGateModule],
  controllers: [BankingController],
  providers: [BankingService, StatementsService, ReconcileService],
  exports: [BankingService],
})
export class BankingModule {}
