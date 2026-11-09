import { Module } from '@nestjs/common';
import { JournalsController } from './journals.controller.js';
import { JournalsService } from './journals.service.js';

@Module({
  controllers: [JournalsController],
  providers: [JournalsService],
  exports: [JournalsService],
})
export class JournalsModule {}
