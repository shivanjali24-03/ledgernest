import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoAssetsApi } from './demoAssetsApi';
import { createLiveAssetsApi } from './liveAssetsApi';
import type { AssetsApi } from './types';

/** The current organisation's fixed assets: the real API, or the demo company checked against the previewed role. */
export function useAssetsApi(): AssetsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('journals.post');
  return useMemo(() => {
    if (client) return organizationId ? createLiveAssetsApi(client, organizationId) : null;
    return createDemoAssetsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
