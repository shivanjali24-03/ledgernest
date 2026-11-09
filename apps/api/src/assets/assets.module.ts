import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Module({
  imports: [JournalsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
