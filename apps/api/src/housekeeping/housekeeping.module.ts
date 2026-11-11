import { Module } from '@nestjs/common';
import { HousekeepingService } from './housekeeping.service.js';

@Module({ providers: [HousekeepingService], exports: [HousekeepingService] })
export class HousekeepingModule {}
