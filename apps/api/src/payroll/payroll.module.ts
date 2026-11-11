import { Module } from '@nestjs/common';
import { JournalsModule } from '../journals/journals.module.js';
import { PayrollController } from './payroll.controller.js';
import { PayrollService } from './payroll.service.js';

@Module({
  imports: [JournalsModule],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
