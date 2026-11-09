import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { useSession } from '../layout/session';
import { createDemoCurrenciesApi } from './demoCurrenciesApi';
import { createLiveCurrenciesApi } from './liveCurrenciesApi';
import type { CurrenciesApi } from './types';

/** The current organisation's currencies: the real API, or the demo company checked against the previewed role. */
export function useCurrenciesApi(): CurrenciesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('currencies.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveCurrenciesApi(client, organizationId) : null;
    return createDemoCurrenciesApi(
      () => canManage,
      (code) => demoAccountRows().filter((a) => a.currency === code).length,
      async (date) => ({ date, entry: null, adjustments: [], missingRates: [] }),
    );
  }, [client, organizationId, canManage]);
}
