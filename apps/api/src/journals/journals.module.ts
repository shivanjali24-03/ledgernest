import { Module } from '@nestjs/common';
import { JournalsController } from './journals.controller.js';
import { ApprovalGateModule } from '../approvals/approval-gate.module.js';
import { JournalsService } from './journals.service.js';

@Module({
  imports: [ApprovalGateModule],
  controllers: [JournalsController],
  providers: [JournalsService],
  exports: [JournalsService],
})
export class JournalsModule {}
