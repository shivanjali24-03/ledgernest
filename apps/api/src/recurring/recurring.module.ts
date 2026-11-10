import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/bills.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { RecurringBillsController } from './recurring-bills.controller.js';
import { RecurringBillsService } from './recurring-bills.service.js';
import { RecurringController } from './recurring.controller.js';
import { RecurringService } from './recurring.service.js';

@Module({
  imports: [InvoicesModule, BillsModule],
  controllers: [RecurringController, RecurringBillsController],
  providers: [RecurringService, RecurringBillsService],
})
export class RecurringModule {}
