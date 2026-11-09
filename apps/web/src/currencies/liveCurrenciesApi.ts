import type { AuthClient } from '../auth/client';
import type { CurrenciesApi } from './types';

/** Currencies backed by the real API, always for one organisation. */
export function createLiveCurrenciesApi(client: AuthClient, organizationId: string): CurrenciesApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/currencies${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    add: (code) => r('', { method: 'POST', json: { code } }),
    remove: (code) => r(`/${code}`, { method: 'DELETE' }),
    rates: (code) => r(`/${code}/rates`),
    setRate: (code, date, rate) => r(`/${code}/rates/${date}`, { method: 'PUT', json: { rate } }),
    removeRate: (code, date) => r(`/${code}/rates/${date}`, { method: 'DELETE' }),
    fetchRates: (date) => r('/rates/fetch', { method: 'POST', json: date ? { date } : {} }),
    revalue: (date) => r('/revalue', { method: 'POST', json: { date } }),
  };
}
