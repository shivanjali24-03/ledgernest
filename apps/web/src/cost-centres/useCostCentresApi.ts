import { useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoCostCentresApi } from './demoCostCentresApi';
import { createLiveCostCentresApi } from './liveCostCentresApi';
import type { CostCentresApi } from './types';

/** The current organisation's cost centres: the real API, or the demo company checked against the previewed role. */
export function useCostCentresApi(): CostCentresApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('accounts.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveCostCentresApi(client, organizationId) : null;
    return createDemoCostCentresApi(() => canManage);
  }, [client, organizationId, canManage]);
}

/** The cost centres lines can be tagged with (archived ones left out); empty when the organisation has none */
export function useCostCentres(includeArchived = false) {
  const session = useSession();
  const api = useCostCentresApi();
  const canView = session.permissions.has('accounts.view');
  return useQuery({ queryKey: ['cost-centres', session.organizationId, session.role ?? session.customRoleName, includeArchived], queryFn: () => api!.list(includeArchived), enabled: !!api && canView });
}
