import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';

/** The webhooks service on its own, so invoices, bills and payments can announce what happened */
@Module({ providers: [WebhooksService], exports: [WebhooksService] })
export class WebhookEventsModule {}
