import { Module } from '@nestjs/common';
import { ApprovalGateModule } from '../approvals/approval-gate.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';

@Module({
  imports: [JournalsModule, ApprovalGateModule, WebhookEventsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
