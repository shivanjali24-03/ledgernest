import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoBankingApi } from './demoBankingApi';
import { createLiveBankingApi } from './liveBankingApi';
import type { BankingApi } from './types';

/** The current organisation's banking: the real API, or the demo company checked against the previewed role. */
export function useBankingApi(): BankingApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions, role, customRoleName } = useSession();
  const who = role ?? customRoleName ?? 'admin';
  const canManage = permissions.has('banking.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveBankingApi(client, organizationId) : null;
    return createDemoBankingApi(() => canManage, { approvalsAs: who });
  }, [client, organizationId, canManage, who]);
}
