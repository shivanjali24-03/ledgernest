import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoRecurringApi } from './demoRecurringApi';
import { createLiveRecurringApi } from './liveRecurringApi';
import type { RecurringApi } from './types';

/** The current organisation's recurring schedules: the real API, or the demo company checked against the previewed role. */
export function useRecurringApi(): RecurringApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('invoices.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveRecurringApi(client, organizationId) : null;
    return createDemoRecurringApi(() => canManage);
  }, [client, organizationId, canManage]);
}
