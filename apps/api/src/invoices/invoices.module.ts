import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { MailModule } from '../mail/mail.module.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
import { JournalsModule } from '../journals/journals.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';

@Module({
  imports: [JournalsModule, InventoryModule, WebhookEventsModule, MailModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceRemindersService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
