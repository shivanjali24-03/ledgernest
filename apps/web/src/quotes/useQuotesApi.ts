import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoQuotesApi } from './demoQuotesApi';
import { createLiveQuotesApi } from './liveQuotesApi';
import type { QuotesApi } from './types';

/** The current organisation's quotes: the real API, or the demo company checked against the previewed role. */
export function useQuotesApi(): QuotesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('invoices.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveQuotesApi(client, organizationId) : null;
    return createDemoQuotesApi(() => canManage);
  }, [client, organizationId, canManage]);
}
