import { Module } from '@nestjs/common';
import { GstSlabsController } from './gst-slabs.controller.js';
import { GstSlabsService } from './gst-slabs.service.js';
import { TaxesController } from './taxes.controller.js';
import { TaxesService } from './taxes.service.js';

@Module({ controllers: [TaxesController, GstSlabsController], providers: [TaxesService, GstSlabsService], exports: [TaxesService] })
export class TaxesModule {}
