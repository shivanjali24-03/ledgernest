import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesService } from './warehouses.service.js';

@Module({
  imports: [JournalsModule],
  controllers: [InventoryController, WarehousesController],
  providers: [InventoryService, WarehousesService],
  exports: [InventoryService],
})
export class InventoryModule {}
