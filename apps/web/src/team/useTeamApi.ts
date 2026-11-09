import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoTeamApi } from './demoTeamApi';
import { createLiveTeamApi } from './liveTeamApi';
import type { TeamApi } from './types';

/**
 * Team management for the current organisation: the real API, or the demo company acting as the previewed role.
 * Null when signed in for real but not a member of any organisation (e.g. a platform-only Super Admin).
 */
export function useTeamApi(): TeamApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, role } = useSession();
  return useMemo(() => {
    if (client) return organizationId ? createLiveTeamApi(client, organizationId) : null;
    const acting = role ?? 'viewer';
    return createDemoTeamApi(() => acting); // demo data lives in storage, so recreating it is cheap
  }, [client, organizationId, role]);
}
