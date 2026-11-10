import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoDebitNotesApi } from './demoDebitNotesApi';
import { createLiveDebitNotesApi } from './liveDebitNotesApi';
import type { DebitNotesApi } from './types';

/** The current organisation's debit notes: the real API, or the demo company checked against the previewed role. */
export function useDebitNotesApi(): DebitNotesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('bills.manage');
  const canRefund = permissions.has('payments.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveDebitNotesApi(client, organizationId) : null;
    return createDemoDebitNotesApi(() => canManage, () => canRefund);
  }, [client, organizationId, canManage, canRefund]);
}
