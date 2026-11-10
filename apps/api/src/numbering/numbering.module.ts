import { Global, Module } from '@nestjs/common';
import { NumberingController } from './numbering.controller.js';
import { NumberingService } from './numbering.service.js';

/** Global: invoices, credit notes and debit notes all take their numbers from it */
@Global()
@Module({
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
