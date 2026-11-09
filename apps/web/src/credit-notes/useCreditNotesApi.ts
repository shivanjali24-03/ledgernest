import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoCreditNotesApi } from './demoCreditNotesApi';
import { createLiveCreditNotesApi } from './liveCreditNotesApi';
import type { CreditNotesApi } from './types';

/** The current organisation's credit notes: the real API, or the demo company checked against the previewed role. */
export function useCreditNotesApi(): CreditNotesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('invoices.manage');
  const canRefund = permissions.has('payments.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveCreditNotesApi(client, organizationId) : null;
    return createDemoCreditNotesApi(() => canManage, () => canRefund);
  }, [client, organizationId, canManage, canRefund]);
}
