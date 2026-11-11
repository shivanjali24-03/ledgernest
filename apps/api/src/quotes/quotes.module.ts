import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { MailModule } from '../mail/mail.module.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';
import {
  PublicQuoteController,
  QuoteShareController,
} from './quote-share.controller.js';
import { QuoteShareService } from './quote-share.service.js';

@Module({
  imports: [
    InvoicesModule,
    MailModule,
    WebhookEventsModule,
    JournalsModule,
    InventoryModule,
  ],
  controllers: [QuotesController, QuoteShareController, PublicQuoteController],
  providers: [QuotesService, QuoteShareService],
})
export class QuotesModule {}
