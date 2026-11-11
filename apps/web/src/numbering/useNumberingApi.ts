import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoNumberingApi } from './demoNumberingApi';
import { createLiveNumberingApi } from './liveNumberingApi';
import type { NumberingApi } from './types';

/** The current organisation's number series: the real API, or the demo company's. Null without an organisation. */
export function useNumberingApi(): NumberingApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('org.settings.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveNumberingApi(client, organizationId) : null;
    return createDemoNumberingApi(() => canManage);
  }, [client, organizationId, canManage]);
}
