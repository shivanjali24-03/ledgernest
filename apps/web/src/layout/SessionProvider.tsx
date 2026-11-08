import { useMemo, useState, type ReactNode } from 'react';
import { BUILT_IN_ROLES, permissionsOf, type BuiltInRoleId } from '@ledgernest/shared';
import { SessionContext, type Session } from './session';

const noSignOut = async () => {};

/** The demo session: sample company, starts as Super Admin, and can preview any built-in role. */
export default function SessionProvider({
  children,
  initialRole = 'super_admin',
  name = 'Shivanjali Desai',
  email = 'admin@ledgernest.demo',
  onSignOut = noSignOut,
}: {
  children: ReactNode;
  initialRole?: BuiltInRoleId;
  name?: string;
  email?: string;
  onSignOut?: () => Promise<void>;
}) {
  const [role, setRole] = useState<BuiltInRoleId>(initialRole);
  const value = useMemo<Session>(
    () => ({
      mode: 'demo',
      name,
      email,
      organization: 'Nest Demo Pvt. Ltd.',
      role,
      permissions: permissionsOf([BUILT_IN_ROLES[role]]),
      setRole,
      signOut: onSignOut,
    }),
    [role, name, email, onSignOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
