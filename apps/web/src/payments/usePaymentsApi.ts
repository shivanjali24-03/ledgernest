import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoPaymentsApi } from './demoPaymentsApi';
import { createLivePaymentsApi } from './livePaymentsApi';
import type { PaymentsApi } from './types';

/** The current organisation's receipts and payments: the real API, or the demo company checked against the previewed role. */
export function usePaymentsApi(): PaymentsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('payments.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLivePaymentsApi(client, organizationId) : null;
    return createDemoPaymentsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
