import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller.js';
import { CurrenciesService } from './currencies.service.js';

@Module({ controllers: [CurrenciesController], providers: [CurrenciesService], exports: [CurrenciesService] })
export class CurrenciesModule {}
