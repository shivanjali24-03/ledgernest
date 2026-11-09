import { useContext, useMemo } from 'react';
import { ApiClientContext } from '../auth/apiClientContext';
import { createDemoBillsApi } from '../bills/demoBillsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPaymentsApi } from '../payments/demoPaymentsApi';
import { useSession } from '../layout/session';
import { createDemoApprovalsApi } from './demoApprovalsApi';
import { createLiveApprovalsApi } from './liveApprovalsApi';
import type { ApprovalsApi } from './types';

/** The current organisation's approvals: the real API, or the demo company with the previewed role as the person. */
export function useApprovalsApi(): ApprovalsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId, permissions, role, customRoleName } = useSession();
  const manage = permissions.has('approvals.manage');
  const approve = permissions.has('approvals.approve');
  const who = role ?? customRoleName ?? 'admin';
  return useMemo(() => {
    if (client) return organizationId ? createLiveApprovalsApi(client, organizationId) : null;
    return createDemoApprovalsApi(
      { manage: () => manage, approve: () => approve },
      () => who,
      () => {
        const journals = createDemoJournalsApi(() => true);
        const bills = createDemoBillsApi(() => true);
        return {
          journal: (id) => journals.get(id).catch(() => null),
          postJournal: (id) => journals.post(id),
          bill: (id) => bills.get(id).catch(() => null),
          recordBill: (id) => bills.record(id),
          pay: (payload) => createDemoPaymentsApi(() => true).pay(payload as Parameters<ReturnType<typeof createDemoPaymentsApi>['pay']>[0]),
        };
      },
    );
  }, [client, organizationId, manage, approve, who]);
}
