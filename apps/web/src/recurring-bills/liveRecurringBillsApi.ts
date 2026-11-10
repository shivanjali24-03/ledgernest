import type { AuthClient } from '../auth/client';
import type { RecurringBillsApi } from './types';

/** Recurring bill schedules backed by the real API, always for one organisation. */
export function createLiveRecurringBillsApi(client: AuthClient, organizationId: string): RecurringBillsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/recurring-bills${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PUT', json: input }),
    setPaused: (id, paused) => r(`/${id}/${paused ? 'pause' : 'resume'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    run: () => r('/run', { method: 'POST' }),
  };
}
