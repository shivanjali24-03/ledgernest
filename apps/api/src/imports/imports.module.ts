import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { ItemsModule } from '../items/items.module.js';
import { JournalsModule } from '../journals/journals.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [AccountsModule, ContactsModule, ItemsModule, JournalsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
