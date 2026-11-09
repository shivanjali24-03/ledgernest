import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoInvoicesApi } from './demoInvoicesApi';
import { createLiveInvoicesApi } from './liveInvoicesApi';
import type { InvoicesApi } from './types';

/** The current organisation's invoices: the real API, or the demo company checked against the previewed role. */
export function useInvoicesApi(): InvoicesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('invoices.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveInvoicesApi(client, organizationId) : null;
    return createDemoInvoicesApi(() => canManage);
  }, [client, organizationId, canManage]);
}
