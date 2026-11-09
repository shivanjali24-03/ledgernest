import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoItemsApi } from './demoItemsApi';
import { createLiveItemsApi } from './liveItemsApi';
import type { ItemsApi } from './types';

/** The current organisation's products and services: the real API, or the demo company checked against the previewed role. */
export function useItemsApi(): ItemsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('invoices.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveItemsApi(client, organizationId) : null;
    return createDemoItemsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
