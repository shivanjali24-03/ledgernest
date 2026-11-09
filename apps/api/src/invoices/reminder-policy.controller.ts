import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { reminderPolicySchema, type ReminderPolicy } from '@ledgernest/shared';
import type { Request } from 'express';
import {
  CurrentActor,
  CurrentTenant,
  RequirePermission,
} from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InvoiceRemindersService } from './invoice-reminders.service.js';

/** The organisation's automatic payment reminders: on or off, when the first goes, how often, how many */
@ApiTags('invoices')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: true,
  description: 'The organisation to act in',
})
@Controller('reminder-policy')
export class ReminderPolicyController {
  constructor(private readonly reminders: InvoiceRemindersService) {}

  @Get()
  @RequirePermission('invoices.view')
  @ApiOkResponse({ description: 'The policy (off, with defaults, until set)' })
  get(@CurrentTenant() tenant: Tenant) {
    return this.reminders.policy(tenant.organizationId);
  }

  @Put()
  @RequirePermission('invoices.manage')
  set(
    @Body(new ZodValidationPipe(reminderPolicySchema)) body: ReminderPolicy,
    @CurrentActor() actor: Actor,
    @CurrentTenant() tenant: Tenant,
    @Req() req: Request,
  ) {
    return this.reminders.setPolicy(body, { actor, tenant, req });
  }
}
