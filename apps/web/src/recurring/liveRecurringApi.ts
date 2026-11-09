import type { AuthClient } from '../auth/client';
import type { RecurringApi } from './types';

/** Recurring schedules backed by the real API, always for one organisation. */
export function createLiveRecurringApi(client: AuthClient, organizationId: string): RecurringApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/recurring-invoices${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    upcoming: (days) => r(`/upcoming?days=${days}`),
    create: (input) => r('', { method: 'POST', json: input }),
    update: (id, input) => r(`/${id}`, { method: 'PUT', json: input }),
    setPaused: (id, paused) => r(`/${id}/${paused ? 'pause' : 'resume'}`, { method: 'POST' }),
    remove: (id) => r(`/${id}`, { method: 'DELETE' }),
    run: () => r('/run', { method: 'POST' }),
  };
}
