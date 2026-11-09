import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoBillsApi } from './demoBillsApi';
import { createLiveBillsApi } from './liveBillsApi';
import type { BillsApi } from './types';

/** The current organisation's bills: the real API, or the demo company checked against the previewed role. */
export function useBillsApi(): BillsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('bills.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveBillsApi(client, organizationId) : null;
    return createDemoBillsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
