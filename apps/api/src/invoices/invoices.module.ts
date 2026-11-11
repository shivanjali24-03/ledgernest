import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { MailModule } from '../mail/mail.module.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';
import { JournalsModule } from '../journals/journals.module.js';
import { InvoicesController } from './invoices.controller.js';
import { ReminderPolicyController } from './reminder-policy.controller.js';
import { EinvoiceService } from './einvoice.service.js';
import {
  CustomerLinkController,
  PublicCustomerController,
} from './customer-link.controller.js';
import { CustomerLinkService } from './customer-link.service.js';
import { InvoiceShareService } from './invoice-share.service.js';
import { PublicInvoicesController } from './public-invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InterestChargesService } from './interest-charges.service.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';
// Stateless: provided here too, for the statement on a customer's account link
import { StatementsService } from '../reports/statements.service.js';

@Module({
  imports: [JournalsModule, InventoryModule, WebhookEventsModule, MailModule],
  controllers: [
    InvoicesController,
    ReminderPolicyController,
    PublicInvoicesController,
    CustomerLinkController,
    PublicCustomerController,
  ],
  providers: [
    InterestChargesService,
    InvoicesService,
    StatementsService,
    InvoiceRemindersService,
    InvoiceShareService,
    EinvoiceService,
    CustomerLinkService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
