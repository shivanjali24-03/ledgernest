import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoPeriodsApi } from './demoPeriodsApi';
import { createLivePeriodsApi } from './livePeriodsApi';
import type { PeriodsApi } from './types';

/** Financial years for the current organisation: the real API, or the demo company checked against the previewed role. */
export function usePeriodsApi(): PeriodsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canClose = permissions.has('periods.close');
  const canReopen = permissions.has('periods.reopen');
  return useMemo(() => {
    if (client) return organizationId ? createLivePeriodsApi(client, organizationId) : null;
    return createDemoPeriodsApi((p) => (p === 'periods.close' ? canClose : canReopen));
  }, [client, organizationId, canClose, canReopen]);
}
