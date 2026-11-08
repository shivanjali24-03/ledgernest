import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import SessionProvider from '../layout/SessionProvider';
import { SessionContext } from '../layout/session';
import { API_URL, ApiError, createAuthClient, type AuthClient } from './client';
import { AuthContext, DEMO_EMAIL, nameFromEmail, type Auth, type AuthState } from './context';
import { liveSession } from './liveSession';

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
export default function AuthProvider({ children, client = defaultClient }: { children: ReactNode; client?: AuthClient | null }) {
  const mode = client ? 'live' : 'demo';
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
      await client.login(email, password);
      setState({ status: 'signedIn', me: await client.me() });
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (client) await client.logout().catch(() => {}); // signed out locally even if the network is down
    writeDemo(null);
    broadcast('signed-out');
    setState({ status: 'signedOut', reason: 'signedOut' });
  }, [client]);

  const auth = useMemo<Auth>(() => ({ mode, state, signIn, signOut }), [mode, state, signIn, signOut]);
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

  return <AuthContext.Provider value={auth}>{content}</AuthContext.Provider>;
}
