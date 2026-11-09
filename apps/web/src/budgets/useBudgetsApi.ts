import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoBudgetsApi } from './demoBudgetsApi';
import { createLiveBudgetsApi } from './liveBudgetsApi';
import type { BudgetsApi } from './types';

/** The current organisation's budgets: the real API, or the demo company checked against the previewed role. */
export function useBudgetsApi(): BudgetsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('accounts.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveBudgetsApi(client, organizationId) : null;
    return createDemoBudgetsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
