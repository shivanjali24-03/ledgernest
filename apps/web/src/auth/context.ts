import { createContext, useContext } from 'react';
import type { MeResponse } from './client';

/** Prefilled on the sign-in form in demo mode. */
export const DEMO_EMAIL = 'admin@ledgernest.demo';
export const DEMO_PASSWORD = 'Demo-Password-2026';

/** Why the user is looking at the sign-in page, so it can say so. */
export type SignedOutReason = 'expired' | 'signedOut' | 'network';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: SignedOutReason }
  | { status: 'signedIn'; me?: MeResponse; demoEmail?: string };

export interface Auth {
  mode: 'live' | 'demo';
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  /** A new person accepts an invitation; their account is created and they're signed in. */
  acceptInvitation: (token: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the signed-in user, e.g. after joining an organisation. */
  reload: () => Promise<void>;
}

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth must be used inside <AuthProvider>');
  return a;
}

/** "asha.rao@acme.in" → "Asha Rao", used as the demo user's name. */
export const nameFromEmail = (email: string) =>
  email
    .split('@')[0]!
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ') || 'Demo User';
