import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoPurchaseOrdersApi } from './demoPurchaseOrdersApi';
import { createLivePurchaseOrdersApi } from './livePurchaseOrdersApi';
import type { PurchaseOrdersApi } from './types';

/** The current organisation's purchase orders: the real API, or the demo company checked against the previewed role. */
export function usePurchaseOrdersApi(): PurchaseOrdersApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('bills.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLivePurchaseOrdersApi(client, organizationId) : null;
    return createDemoPurchaseOrdersApi(() => canManage);
  }, [client, organizationId, canManage]);
}
