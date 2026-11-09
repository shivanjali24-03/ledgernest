import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoBackupsApi } from './demoBackupsApi';
import { createLiveBackupsApi } from './liveBackupsApi';
import type { BackupsApi } from './types';

/** Backups for the current organisation: the real API, or the demo company in this browser. */
export function useBackupsApi(): BackupsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const owner = permissions.has('org.delete');
  return useMemo(() => {
    if (client) return organizationId ? createLiveBackupsApi(client, organizationId) : null;
    return createDemoBackupsApi(() => owner);
  }, [client, organizationId, owner]);
}
