import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SessionProvider from '../layout/SessionProvider';
import { SessionContext } from '../layout/session';
import { API_URL, ApiError, createAuthClient, type AuthClient } from './client';
import { AuthContext, DEMO_EMAIL, nameFromEmail, type Auth, type AuthState } from './context';
import { liveSession } from './liveSession';
import { PlatformApiContext } from '../platform/context';
import { ApiClientContext } from './apiClientContext';
import { createDemoPlatformApi, demoAcceptAsNewUser } from '../platform/demoApi';
import { createLivePlatformApi } from '../platform/liveApi';
import type { PlatformApi } from '../platform/types';

const DEMO_KEY = 'ledgernest.demo';
const CHANNEL = 'ledgernest-auth';

const defaultClient = API_URL ? createAuthClient(API_URL) : null;

const readDemo = (): string | null => {
  try {
    return sessionStorage.getItem(DEMO_KEY);
  } catch {
    return null;
  }
};
const writeDemo = (email: string | null) => {
  try {
    if (email) sessionStorage.setItem(DEMO_KEY, email);
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* private mode: the demo just won't survive a reload */
  }
};

/** Tells other open tabs about sign-out, so nobody keeps working in a dead session. */
const broadcast = (message: 'signed-out') => {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.postMessage(message);
  ch.close();
};

/**
 * Owns the signed-in state.
 * - Live mode (VITE_API_URL set): restores the session from the refresh cookie on load.
 * - Demo mode: any email and password opens the sample company; nothing leaves the browser.
 */
export default function AuthProvider({
  children,
  client = defaultClient,
  platformApi: platformApiOverride,
}: {
  children: ReactNode;
  client?: AuthClient | null;
  /** Tests can supply their own console data source */
  platformApi?: PlatformApi;
}) {
  const mode = client ? 'live' : 'demo';
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() => {
    if (client) return { status: 'loading' };
    const demoEmail = readDemo();
    return demoEmail ? { status: 'signedIn', demoEmail } : { status: 'signedOut' };
  });

  // Live: try to resume the session (the refresh cookie survives reloads, the access token doesn't)
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .refresh()
      .then((ok) => (ok ? client.me() : null))
      .then(
        (me) => !cancelled && setState(me ? { status: 'signedIn', me } : { status: 'signedOut' }),
        (e: unknown) => !cancelled && setState({ status: 'signedOut', reason: e instanceof ApiError && e.kind === 'network' ? 'network' : undefined }),
      );
    const off = client.onSessionLost(() => setState({ status: 'signedOut', reason: 'expired' }));
    return () => {
      cancelled = true;
      off();
    };
  }, [client]);

  // Another tab signed out: follow it
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if (e.data !== 'signed-out') return;
      writeDemo(null);
      setState({ status: 'signedOut', reason: 'signedOut' });
    };
    return () => ch.close();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) {
        writeDemo(email);
        setState({ status: 'signedIn', demoEmail: email });
        return;
      }
      const second = await client.login(email, password);
      if (second) return second;
      queryClient.clear(); // never show the previous user's cached data
      setState({ status: 'signedIn', me: await client.me() });
    },
    [client, queryClient],
  );

  const signInTwoFactor = useCallback(
    async (ticket: string, code: string) => {
      if (!client) return;
      await client.loginTwoFactor(ticket, code);
      queryClient.clear();
      setState({ status: 'signedIn', me: await client.me() });
    },
    [client, queryClient],
  );

  const acceptInvitation = useCallback(
    async (token: string, name: string, password: string) => {
      if (!client) {
        const email = demoAcceptAsNewUser(token, name);
        writeDemo(email);
        setState({ status: 'signedIn', demoEmail: email });
        return;
      }
      await client.acceptInvitation(token, name, password);
      setState({ status: 'signedIn', me: await client.me() });
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (client) await client.logout().catch(() => {}); // signed out locally even if the network is down
    writeDemo(null);
    broadcast('signed-out');
    queryClient.clear();
    setState({ status: 'signedOut', reason: 'signedOut' });
  }, [client, queryClient]);

  const reload = useCallback(async () => {
    if (client) setState({ status: 'signedIn', me: await client.me() });
  }, [client]);

  // In the demo there are no real passwords: these succeed without doing anything
  const forgotPassword = useCallback(async (email: string) => {
    if (client) await client.forgotPassword(email);
  }, [client]);
  const resetPassword = useCallback(async (token: string, password: string) => {
    if (client) await client.resetPassword(token, password);
  }, [client]);
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (client) await client.changePassword(currentPassword, newPassword);
  }, [client]);
  const signOutEverywhere = useCallback(async () => {
    if (client) await client.logoutAll().catch(() => {});
    writeDemo(null);
    broadcast('signed-out');
    queryClient.clear();
    setState({ status: 'signedOut', reason: 'signedOut' });
  }, [client, queryClient]);

  const deleteAccount = useCallback(
    async (password: string) => {
      if (client) await client.deleteAccount(password);
      writeDemo(null);
      broadcast('signed-out');
      queryClient.clear();
      setState({ status: 'signedOut', reason: 'signedOut' });
    },
    [client, queryClient],
  );

  const auth = useMemo<Auth>(() => ({ mode, state, signIn, signInTwoFactor, acceptInvitation, signOut, reload, forgotPassword, resetPassword, changePassword, signOutEverywhere, deleteAccount }), [mode, state, signIn, signInTwoFactor, acceptInvitation, signOut, reload, forgotPassword, resetPassword, changePassword, signOutEverywhere, deleteAccount]);
  const platformApi = useMemo(() => platformApiOverride ?? (client ? createLivePlatformApi(client) : createDemoPlatformApi()), [client, platformApiOverride]);
  const session = useMemo(() => (state.status === 'signedIn' && state.me ? liveSession(state.me, signOut) : null), [state, signOut]);

  let content = children;
  if (session) content = <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
  else if (state.status === 'signedIn' && state.demoEmail) {
    const demoName = state.demoEmail === DEMO_EMAIL ? undefined : nameFromEmail(state.demoEmail);
    content = (
      <SessionProvider name={demoName} email={state.demoEmail} onSignOut={signOut}>
        {children}
      </SessionProvider>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <ApiClientContext.Provider value={client}>
        <PlatformApiContext.Provider value={platformApi}>{content}</PlatformApiContext.Provider>
      </ApiClientContext.Provider>
    </AuthContext.Provider>
  );
}
