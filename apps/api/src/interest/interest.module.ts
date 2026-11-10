import { Global, Module } from '@nestjs/common';
import { InterestService } from './interest.service.js';

/** Global: statements, links, reminders and reports all show interest on late payment */
@Global()
@Module({ providers: [InterestService], exports: [InterestService] })
export class InterestModule {}
