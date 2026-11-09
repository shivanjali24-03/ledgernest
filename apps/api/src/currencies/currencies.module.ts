import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { CurrenciesController } from './currencies.controller.js';
import { CurrenciesService } from './currencies.service.js';

@Module({ imports: [JournalsModule], controllers: [CurrenciesController], providers: [CurrenciesService], exports: [CurrenciesService] })
export class CurrenciesModule {}
