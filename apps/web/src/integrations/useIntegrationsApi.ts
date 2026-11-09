import { useContext, useMemo } from 'react';
import type { OrganizationPermission } from '@ledgernest/shared';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoIntegrationsApi } from './demoIntegrationsApi';
import { createLiveIntegrationsApi } from './liveIntegrationsApi';
import type { IntegrationsApi } from './types';

/** API keys and webhooks for the current organisation: the real API, or the demo company. */
export function useIntegrationsApi(): IntegrationsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  return useMemo(() => {
    if (client) return organizationId ? createLiveIntegrationsApi(client, organizationId) : null;
    return createDemoIntegrationsApi((p: OrganizationPermission) => permissions.has(p));
  }, [client, organizationId, permissions]);
}
