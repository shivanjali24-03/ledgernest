import type { AuthClient } from '../auth/client';
import type { ReportsApi } from './types';

/** Reports backed by the real API, always for one organisation. */
export function createLiveReportsApi(client: AuthClient, organizationId: string): ReportsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string) => client.request<T>(`/reports${path}`, { headers });
  const file = async (path: string, fallback: string) => {
    const { blob, filename } = await client.download(`/reports${path}`, { headers });
    return { blob, filename: filename ?? fallback };
  };
  return {
    trialBalance: (asOf) => r(`/trial-balance?asOf=${asOf}`),
    ledger: (accountId, from, to) => r(`/ledger?accountId=${accountId}&from=${from}&to=${to}`),
    exportTrialBalance: (asOf) => file(`/trial-balance/export?asOf=${asOf}`, `trial-balance-${asOf}.csv`),
    exportLedger: (accountId, from, to) => file(`/ledger/export?accountId=${accountId}&from=${from}&to=${to}`, `ledger-${from}-${to}.csv`),
  };
}
