import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { RecurringController } from './recurring.controller.js';
import { RecurringService } from './recurring.service.js';

@Module({
  imports: [InvoicesModule],
  controllers: [RecurringController],
  providers: [RecurringService],
})
export class RecurringModule {}
