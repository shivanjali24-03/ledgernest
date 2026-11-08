import { createContext, useContext } from 'react';
import type { BuiltInRoleId, Permission } from '@ledgernest/shared';

/**
 * Who is signed in. Until authentication lands (#7) this is a local demo session
 * that starts as the Super Admin; the role can be switched to preview other roles.
 */
export interface Session {
  name: string;
  email: string;
  organization: string;
  role: BuiltInRoleId;
  permissions: ReadonlySet<Permission>;
  setRole: (role: BuiltInRoleId) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
