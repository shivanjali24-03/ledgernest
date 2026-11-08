import { useMemo, useState, type ReactNode } from 'react';
import { BUILT_IN_ROLES, permissionsOf, type BuiltInRoleId } from '@ledgernest/shared';
import { SessionContext, type Session } from './session';

export default function SessionProvider({ children, initialRole = 'super_admin' }: { children: ReactNode; initialRole?: BuiltInRoleId }) {
  const [role, setRole] = useState<BuiltInRoleId>(initialRole);
  const value = useMemo<Session>(
    () => ({
      name: 'Shivanjali Desai',
      email: 'admin@ledgernest.demo',
      organization: 'Nest Demo Pvt. Ltd.',
      role,
      permissions: permissionsOf([BUILT_IN_ROLES[role]]),
      setRole,
    }),
    [role],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

