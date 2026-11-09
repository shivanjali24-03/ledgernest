import type { ApiKeyCreateInput, ApiKeyScope, WebhookEvent, WebhookInput } from '@ledgernest/shared';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  createdBy: { name: string; email: string };
}
export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  lastDelivery: { status: string; createdAt: string } | null;
}
export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

/** API keys and webhooks. Live and demo both implement it. */
export interface IntegrationsApi {
  keys(): Promise<ApiKey[]>;
  createKey(input: ApiKeyCreateInput): Promise<ApiKey & { key: string }>;
  revokeKey(id: string): Promise<void>;
  webhooks(): Promise<Webhook[]>;
  createWebhook(input: WebhookInput): Promise<Webhook & { secret: string }>;
  updateWebhook(id: string, input: Partial<WebhookInput>): Promise<Webhook>;
  rotateSecret(id: string): Promise<{ secret: string }>;
  removeWebhook(id: string): Promise<void>;
  deliveries(id: string): Promise<WebhookDelivery[]>;
  ping(id: string): Promise<WebhookDelivery>;
  retry(deliveryId: string): Promise<WebhookDelivery>;
}
