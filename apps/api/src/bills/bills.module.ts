import { Module } from '@nestjs/common';
import { ApprovalGateModule } from '../approvals/approval-gate.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

@Module({
  imports: [JournalsModule, InventoryModule, ApprovalGateModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
