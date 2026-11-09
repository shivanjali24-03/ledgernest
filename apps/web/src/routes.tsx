import { Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import type { Permission } from '@ledgernest/shared';
import RequireAuth, { Splash } from './auth/RequireAuth';
import AppShell from './layout/AppShell';
import { NAV } from './layout/nav';
import RequirePermission from './layout/RequirePermission';
import { AcceptInvite, ChartOfAccounts, ComingSoon, Contacts, Currencies, Dashboard, FiscalYears, GstSlabs, Items, JournalEditor, Journals, Reports, OrganizationAudit, OrganizationDetail, Organizations, PlatformAudit, PlatformOverview, PlatformUsers, Settings, SignIn, Taxes, Team } from './pages';

const page = (el: ReactNode, permission?: Permission) => (
  <Suspense fallback={null}>{permission ? <RequirePermission permission={permission}>{el}</RequirePermission> : el}</Suspense>
);

/** Pages that are built. Everything else in the menu opens the roadmap page. */
const BUILT: RouteObject[] = [
  { path: 'accounts', element: page(<ChartOfAccounts />, 'accounts.view') },
  { path: 'periods', element: page(<FiscalYears />, 'accounts.view') },
  { path: 'journals', element: page(<Journals />, 'journals.view') },
  { path: 'journals/:id', element: page(<JournalEditor />, 'journals.view') },
  { path: 'reports', element: page(<Reports />, 'reports.view') },
  { path: 'taxes', element: page(<Taxes />, 'accounts.view') },
  { path: 'currencies', element: page(<Currencies />, 'accounts.view') },
  { path: 'contacts', element: page(<Contacts />, 'contacts.view') },
  { path: 'items', element: page(<Items />, 'invoices.view') },
  { path: 'users', element: page(<Team />, 'users.view') },
  { path: 'audit', element: page(<OrganizationAudit />, 'audit.view') },
  { path: 'settings', element: page(<Settings />, 'org.settings.view') },
  { path: 'platform', element: page(<PlatformOverview />, 'platform.organizations.view') },
  { path: 'platform/organizations', element: page(<Organizations />, 'platform.organizations.view') },
  { path: 'platform/organizations/:id', element: page(<OrganizationDetail />, 'platform.organizations.view') },
  { path: 'platform/users', element: page(<PlatformUsers />, 'platform.users.view') },
  { path: 'platform/gst-slabs', element: page(<GstSlabs />, 'platform.settings.manage') },
  { path: 'platform/audit', element: page(<PlatformAudit />, 'platform.audit.view') },
];
const builtPaths = new Set(BUILT.map((r) => `/${r.path}`));

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
    // Public: people accept before they have an account
    path: '/accept-invite',
    element: (
      <Suspense fallback={<Splash />}>
        <AcceptInvite />
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
      ...BUILT,
      ...NAV.flatMap((g) => g.items)
        .filter((i) => i.to !== '/' && !builtPaths.has(i.to))
        .map((i) => ({ path: i.to.slice(1), element: page(<ComingSoon />) })),
      { path: '*', element: page(<ComingSoon />) },
    ],
  },
];
