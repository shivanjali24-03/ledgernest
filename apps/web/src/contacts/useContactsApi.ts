import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoContactsApi } from './demoContactsApi';
import { createLiveContactsApi } from './liveContactsApi';
import type { ContactsApi } from './types';

/** The current organisation's customers and vendors: the real API, or the demo company checked against the previewed role. */
export function useContactsApi(): ContactsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canManage = permissions.has('contacts.manage');
  return useMemo(() => {
    if (client) return organizationId ? createLiveContactsApi(client, organizationId) : null;
    return createDemoContactsApi(() => canManage);
  }, [client, organizationId, canManage]);
}
