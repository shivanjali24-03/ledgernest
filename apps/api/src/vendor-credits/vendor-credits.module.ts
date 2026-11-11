import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { VendorCreditsController } from './vendor-credits.controller.js';
import { DebitNotePdfService } from './debit-note-pdf.service.js';
import { VendorCreditsService } from './vendor-credits.service.js';

@Module({
  imports: [JournalsModule, InventoryModule, MailModule],
  controllers: [VendorCreditsController],
  providers: [VendorCreditsService, DebitNotePdfService],
  exports: [VendorCreditsService],
})
export class VendorCreditsModule {}
