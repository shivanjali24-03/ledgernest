import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';
import { WebhookEventsModule } from './webhook-events.module.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [WebhookEventsModule],
  controllers: [ApiKeysController, WebhooksController],
  providers: [ApiKeysService],
})
export class IntegrationsModule {}
