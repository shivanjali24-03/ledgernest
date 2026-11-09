import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

@Module({
  imports: [JournalsModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
