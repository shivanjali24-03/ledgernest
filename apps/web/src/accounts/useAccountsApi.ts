import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoAccountsApi } from './demoAccountsApi';
import { createLiveAccountsApi } from './liveAccountsApi';
import type { AccountsApi } from './types';

/** The current organisation's chart of accounts: the real API, or the demo company checked against the previewed role. */
export function useAccountsApi(): AccountsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('accounts.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveAccountsApi(client, organizationId) : null;
    return createDemoAccountsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
