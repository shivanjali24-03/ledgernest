import { Module } from '@nestjs/common';
import { GstRegistrationsController } from './gst-registrations.controller.js';
import { GstRegistrationsService } from './gst-registrations.service.js';

@Module({
  controllers: [GstRegistrationsController],
  providers: [GstRegistrationsService],
})
export class GstRegistrationsModule {}
