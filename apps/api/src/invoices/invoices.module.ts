import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { MailModule } from '../mail/mail.module.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
import { JournalsModule } from '../journals/journals.module.js';
import { InvoicesController } from './invoices.controller.js';
import { ReminderPolicyController } from './reminder-policy.controller.js';
import { InvoiceShareService } from './invoice-share.service.js';
import { PublicInvoicesController } from './public-invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';

@Module({
  imports: [JournalsModule, InventoryModule, WebhookEventsModule, MailModule],
  controllers: [
    InvoicesController,
    ReminderPolicyController,
    PublicInvoicesController,
  ],
  providers: [InvoicesService, InvoiceRemindersService, InvoiceShareService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
