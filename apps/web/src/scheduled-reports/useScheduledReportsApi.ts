import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoScheduledReportsApi } from './demoScheduledReportsApi';
import { createLiveScheduledReportsApi } from './liveScheduledReportsApi';
import type { ScheduledReportsApi } from './types';

/** Scheduled reports for the current organisation: the real API, or the demo company checked against the previewed role. */
export function useScheduledReportsApi(): ScheduledReportsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canExport = permissions.has('reports.export');
  return useMemo(() => {
    if (client) return organizationId ? createLiveScheduledReportsApi(client, organizationId) : null;
    return createDemoScheduledReportsApi(() => canExport);
  }, [client, organizationId, canExport]);
}
