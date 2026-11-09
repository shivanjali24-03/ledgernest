import type { AuthClient } from '../auth/client';
import type { InventoryApi } from './types';

/** Stock backed by the real API, always for one organisation. */
export function createLiveInventoryApi(client: AuthClient, organizationId: string): InventoryApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/inventory${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    valuation: (asOf) => r(`/valuation${asOf ? `?asOf=${asOf}` : ''}`),
    movements: (itemId) => r(`/items/${itemId}/movements`),
    adjust: (input) => r('/adjustments', { method: 'POST', json: input }),
    undoAdjustment: (id) => r(`/adjustments/${id}`, { method: 'DELETE' }),
  };
}
