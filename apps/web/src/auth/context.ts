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
  /** Signs in; with two-factor on, resolves to a ticket for signInTwoFactor */
  signIn: (email: string, password: string) => Promise<{ ticket: string } | void>;
  /** The second step of signing in, with the code from the authenticator app (or a recovery code) */
  signInTwoFactor: (ticket: string, code: string) => Promise<void>;
  /** A new person accepts an invitation; their account is created and they're signed in. */
  acceptInvitation: (token: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the signed-in user, e.g. after joining an organisation. */
  reload: () => Promise<void>;
  /** Emails a reset link (the demo sends nothing) */
  forgotPassword: (email: string) => Promise<void>;
  /** Sets a new password from a reset link */
  resetPassword: (token: string, password: string) => Promise<void>;
  /** Changes the signed-in person's password; other devices are signed out */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Signs out every device, this one included */
  signOutEverywhere: () => Promise<void>;
  /** Erases the signed-in person's account (the demo just signs out) */
  deleteAccount: (password: string) => Promise<void>;
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
