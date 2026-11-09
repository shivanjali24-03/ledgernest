import { Suspense, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import type { Permission } from '@ledgernest/shared';
import RequireAuth, { Splash } from './auth/RequireAuth';
import AppShell from './layout/AppShell';
import { NAV } from './layout/nav';
import RequirePermission from './layout/RequirePermission';
import { AcceptInvite, Approvals, Banking, Imports, Integrations, BillEditor, Bills, Budgets, CostCentres, Inventory, ChartOfAccounts, CreditNotes, FixedAssets, Reconcile, Recurring, ComingSoon, Contacts, ContactPage, Quotes, QuoteEditor, Currencies, Dashboard, FiscalYears, GstSlabs, InvoiceEditor, Invoices, Items, JournalEditor, Journals, Reports, OrganizationAudit, OrganizationDetail, Organizations, Payments, PlatformAudit, PlatformOverview, PlatformUsers, Settings, SignIn, Taxes, Team } from './pages';

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
  { path: 'contacts/:id', element: page(<ContactPage />, 'contacts.view') },
  { path: 'items', element: page(<Items />, 'invoices.view') },
  { path: 'invoices', element: page(<Invoices />, 'invoices.view') },
  { path: 'invoices/:id', element: page(<InvoiceEditor />, 'invoices.view') },
  { path: 'quotes', element: page(<Quotes />, 'invoices.view') },
  { path: 'quotes/:id', element: page(<QuoteEditor />, 'invoices.view') },
  { path: 'credit-notes', element: page(<CreditNotes />, 'invoices.view') },
  { path: 'recurring', element: page(<Recurring />, 'invoices.view') },
  { path: 'banking', element: page(<Banking />, 'banking.view') },
  { path: 'fixed-assets', element: page(<FixedAssets />, 'accounts.view') },
  { path: 'budgets', element: page(<Budgets />, 'reports.view') },
  { path: 'cost-centres', element: page(<CostCentres />, 'accounts.view') },
  { path: 'inventory', element: page(<Inventory />, 'reports.view') },
  { path: 'approvals', element: page(<Approvals />, 'journals.view') },
  { path: 'imports', element: page(<Imports />, 'org.settings.view') },
  { path: 'integrations', element: page(<Integrations />, 'integrations.manage') },
  { path: 'banking/reconcile/:accountId', element: page(<Reconcile />, 'banking.view') },
  { path: 'bills', element: page(<Bills />, 'bills.view') },
  { path: 'bills/:id', element: page(<BillEditor />, 'bills.view') },
  { path: 'payments', element: page(<Payments />, 'invoices.view') },
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
