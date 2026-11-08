import { Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import RequireAuth, { Splash } from './auth/RequireAuth';
import AppShell from './layout/AppShell';
import { NAV } from './layout/nav';
import { ComingSoon, Dashboard, SignIn } from './pages';

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

/** Every route in the app. Shared by the browser router and the tests. */
export const routes: RouteObject[] = [
  {
    path: '/sign-in',
    element: (
      <Suspense fallback={<Splash />}>
        <SignIn />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<Dashboard />) },
      ...NAV.flatMap((g) => g.items)
        .filter((i) => i.to !== '/')
        .map((i) => ({ path: i.to.slice(1), element: page(<ComingSoon />) })),
      { path: '*', element: page(<ComingSoon />) },
    ],
  },
];
