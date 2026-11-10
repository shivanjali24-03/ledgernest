import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { WebhookEventsModule } from '../integrations/webhook-events.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { CreditNotesController } from './credit-notes.controller.js';
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import { CreditNotesService } from './credit-notes.service.js';

@Module({
  imports: [JournalsModule, InventoryModule, WebhookEventsModule, MailModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService, CreditNotePdfService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
