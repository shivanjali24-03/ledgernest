import { useContext, useMemo } from 'react';
import type { OrganizationPermission } from '@ledgernest/shared';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoAttachmentsApi } from './demoAttachmentsApi';
import { createLiveAttachmentsApi } from './liveAttachmentsApi';
import type { AttachmentsApi } from './types';

/** Attachments for the current organisation: the real API, or the demo company checked against the previewed role. */
export function useAttachmentsApi(): AttachmentsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  return useMemo(() => {
    if (client) return organizationId ? createLiveAttachmentsApi(client, organizationId) : null;
    return createDemoAttachmentsApi((p: OrganizationPermission) => permissions.has(p));
  }, [client, organizationId, permissions]);
}
