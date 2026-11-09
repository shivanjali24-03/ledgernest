import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoReportsApi } from './demoReportsApi';
import { createLiveReportsApi } from './liveReportsApi';
import type { ReportsApi } from './types';

/** Reports for the current organisation: the real API, or computed from the demo company's entries. */
export function useReportsApi(): ReportsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canExport = permissions.has('reports.export');
  return useMemo(() => {
    if (client) return organizationId ? createLiveReportsApi(client, organizationId) : null;
    return createDemoReportsApi(() => canExport);
  }, [client, organizationId, canExport]);
}
