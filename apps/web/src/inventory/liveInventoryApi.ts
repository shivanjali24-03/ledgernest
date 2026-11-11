import type { AuthClient } from '../auth/client';
import type { InventoryApi } from './types';

/** Stock backed by the real API, always for one organisation. */
export function createLiveInventoryApi(client: AuthClient, organizationId: string): InventoryApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/inventory${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  const w = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/warehouses${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    warehouses: () => w(''),
    createWarehouse: (input) => w('', { method: 'POST', json: input }),
    updateWarehouse: (id, input) => w(`/${id}`, { method: 'PATCH', json: input }),
    archiveWarehouse: (id) => w(`/${id}/archive`, { method: 'POST' }),
    warehouseStock: (id) => w(`/${id}/stock`),
    transfers: () => r('/transfers'),
    transfer: (input) => r('/transfers', { method: 'POST', json: input }),
    valuation: (asOf) => r(`/valuation${asOf ? `?asOf=${asOf}` : ''}`),
    movements: (itemId) => r(`/items/${itemId}/movements`),
    expiring: (days) => r(`/expiring?days=${days}`),
    openingStock: (input) => r('/opening-stock', { method: 'POST', json: input }),
    serial: (serial) => r(`/serials/${encodeURIComponent(serial)}`),
    adjust: (input) => r('/adjustments', { method: 'POST', json: input }),
    undoAdjustment: (id) => r(`/adjustments/${id}`, { method: 'DELETE' }),
  };
}
