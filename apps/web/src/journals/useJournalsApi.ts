import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import { createDemoJournalsApi } from './demoJournalsApi';
import { createLiveJournalsApi } from './liveJournalsApi';
import type { JournalsApi } from './types';

/** Journal entries for the current organisation: the real API, or the demo company checked against the previewed role. */
export function useJournalsApi(): JournalsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions, role, customRoleName } = useSession();
  const who = role ?? customRoleName ?? 'admin';
  const flags = ['journals.create', 'journals.post', 'journals.reverse'].map((p) => permissions.has(p as 'journals.create')).join();
  return useMemo(() => {
    if (client) return organizationId ? createLiveJournalsApi(client, organizationId) : null;
    const [create, post, reverse] = flags.split(',').map((f) => f === 'true');
    return createDemoJournalsApi((p) => (p === 'journals.create' ? create! : p === 'journals.post' ? post! : reverse!), { approvalsAs: who });
  }, [client, organizationId, flags, who]);
}
