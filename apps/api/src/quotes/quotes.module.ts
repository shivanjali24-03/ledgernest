import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [InvoicesModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
