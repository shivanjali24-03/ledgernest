import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { PeriodsController } from './periods.controller.js';
import { PeriodsService } from './periods.service.js';

@Module({ imports: [JournalsModule], controllers: [PeriodsController], providers: [PeriodsService], exports: [PeriodsService] })
export class PeriodsModule {}
