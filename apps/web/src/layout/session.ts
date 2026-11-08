import { createContext, useContext } from 'react';
import type { TFunction } from 'i18next';
import type { BuiltInRoleId, Permission } from '@ledgernest/shared';

/** Who is signed in, and what they may do. Available to every page inside the app shell. */
export interface Session {
  /** "live" is backed by the API; "demo" runs entirely in the browser with sample data */
  mode: 'live' | 'demo';
  name: string;
  email: string;
  /** null for a platform Super Admin who isn't a member of any organisation yet */
  organization: string | null;
  /** null when the user's role in this organisation is a custom one */
  role: BuiltInRoleId | null;
  customRoleName?: string;
  permissions: ReadonlySet<Permission>;
  /** Demo only: preview the app as another role */
  setRole?: (role: BuiltInRoleId) => void;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside a signed-in area');
  return s;
}

/** The role name to show, translated for built-in roles. */
export const roleLabel = (s: Session, t: TFunction) => (s.role ? t(`roles.${s.role}`) : (s.customRoleName ?? ''));

/** Initials for the avatar: "Asha Rao" → "AR", "zoë" → "Z". */
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
