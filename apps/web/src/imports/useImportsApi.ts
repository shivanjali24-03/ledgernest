import { useContext, useMemo } from 'react';
import type { OrganizationPermission } from '@ledgernest/shared';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoImportsApi } from './demoImportsApi';
import { createLiveImportsApi } from './liveImportsApi';
import type { ImportsApi } from './types';

/** Imports for the current organisation: the real API, or the demo company checked against the previewed role. */
export function useImportsApi(): ImportsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  return useMemo(() => {
    if (client) return organizationId ? createLiveImportsApi(client, organizationId) : null;
    return createDemoImportsApi((p: OrganizationPermission) => permissions.has(p));
  }, [client, organizationId, permissions]);
}
