import type { AuthClient } from '../auth/client';
import type { IntegrationsApi } from './types';

/** API keys and webhooks backed by the real API, always for one organisation. */
export function createLiveIntegrationsApi(client: AuthClient, organizationId: string): IntegrationsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(path, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    keys: () => r('/api-keys'),
    createKey: (input) => r('/api-keys', { method: 'POST', json: input }),
    revokeKey: (id) => r(`/api-keys/${id}`, { method: 'DELETE' }),
    webhooks: () => r('/webhooks'),
    createWebhook: (input) => r('/webhooks', { method: 'POST', json: input }),
    updateWebhook: (id, input) => r(`/webhooks/${id}`, { method: 'PATCH', json: input }),
    rotateSecret: (id) => r(`/webhooks/${id}/rotate`, { method: 'POST' }),
    removeWebhook: (id) => r(`/webhooks/${id}`, { method: 'DELETE' }),
    deliveries: (id) => r(`/webhooks/${id}/deliveries`),
    ping: (id) => r(`/webhooks/${id}/ping`, { method: 'POST' }),
    retry: (deliveryId) => r(`/webhooks/deliveries/${deliveryId}/retry`, { method: 'POST' }),
  };
}
