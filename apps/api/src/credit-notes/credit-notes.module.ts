import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { CreditNotesController } from './credit-notes.controller.js';
import { CreditNotesService } from './credit-notes.service.js';

@Module({
  imports: [JournalsModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
