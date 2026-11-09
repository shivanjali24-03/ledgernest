import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoAuditApi } from './demoAuditApi';
import { createLiveAuditApi } from './liveAuditApi';
import type { AuditApi, AuditScope } from './types';

/**
 * One audit log: the real API, or the demo history checked against the previewed role.
 * The organisation log is null when signed in for real without an organisation.
 */
export function useAuditApi(scope: AuditScope): AuditApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions } = useSession();
  const canView = permissions.has(scope === 'platform' ? 'platform.audit.view' : 'audit.view');
  return useMemo(() => {
    if (client) return scope === 'organization' && !organizationId ? null : createLiveAuditApi(client, scope, organizationId);
    return createDemoAuditApi(scope, () => canView);
  }, [client, scope, organizationId, canView]);
}
