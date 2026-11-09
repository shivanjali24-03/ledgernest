import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoInventoryApi } from './demoInventoryApi';
import { createLiveInventoryApi } from './liveInventoryApi';
import type { InventoryApi } from './types';

/** The current organisation's stock: the real API, or the demo company checked against the previewed role. */
export function useInventoryApi(): InventoryApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canPost = permissions.has('journals.post');
  return useMemo(() => {
    if (client) return organizationId ? createLiveInventoryApi(client, organizationId) : null;
    return createDemoInventoryApi(() => canPost);
  }, [client, organizationId, canPost]);
}
