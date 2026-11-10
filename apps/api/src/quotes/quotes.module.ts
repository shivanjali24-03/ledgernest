import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { MailModule } from '../mail/mail.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [InvoicesModule, MailModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
