import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/bills.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ApprovalGateModule } from './approval-gate.module.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

@Module({
  imports: [ApprovalGateModule, JournalsModule, BillsModule, PaymentsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
