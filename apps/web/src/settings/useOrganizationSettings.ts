import { useQuery } from '@tanstack/react-query';
import { useSession } from '../layout/session';
import { useSettingsApi } from './useSettingsApi';

/** The current organisation's settings, shared (and cached) with the Settings page. */
export function useOrganizationSettings() {
  const session = useSession();
  const api = useSettingsApi();
  return useQuery({ queryKey: ['settings', session.organizationId, session.role ?? session.customRoleName], queryFn: () => api!.get(), enabled: !!api, staleTime: 60_000 });
}
