import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoSettingsApi } from './demoSettingsApi';
import { createLiveSettingsApi } from './liveSettingsApi';
import type { SettingsApi } from './types';

/** The current organisation's settings: the real API, or the demo company checked against the previewed role. Null without an organisation. */
export function useSettingsApi(): SettingsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('org.settings.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveSettingsApi(client, organizationId) : null;
    return createDemoSettingsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
