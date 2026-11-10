import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoRecurringBillsApi } from './demoRecurringBillsApi';
import { createLiveRecurringBillsApi } from './liveRecurringBillsApi';
import type { RecurringBillsApi } from './types';

/** The current organisation's bill schedules: the real API, or the demo company checked against the previewed role. */
export function useRecurringBillsApi(): RecurringBillsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('bills.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveRecurringBillsApi(client, organizationId) : null;
    return createDemoRecurringBillsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
