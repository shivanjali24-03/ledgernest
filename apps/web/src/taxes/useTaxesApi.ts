import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoGstSlabsApi } from './demoGstSlabs';
import { createDemoTaxesApi, demoSlabUsage } from './demoTaxesApi';
import { createLiveGstSlabsApi, createLiveTaxesApi } from './liveTaxesApi';
import type { GstSlabsApi, TaxesApi } from './types';

/** The current organisation's taxes: the real API, or the demo company checked against the previewed role. */
export function useTaxesApi(): TaxesApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('taxes.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveTaxesApi(client, organizationId) : null;
    return createDemoTaxesApi(() => canManage);
  }, [client, organizationId, canManage]);
}

/** The Super Admin's GST slabs. */
export function useGstSlabsApi(): GstSlabsApi {
  const client = useContext(ApiClientContext);
  const { permissions } = useSession();
  const canManage = permissions.has('platform.settings.manage');
  return useMemo(() => (client ? createLiveGstSlabsApi(client) : createDemoGstSlabsApi(() => canManage, demoSlabUsage)), [client, canManage]);
}
