import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarRange,
  Building2,
  FileText,
  Gauge,
  History,
  Landmark,
  LayoutDashboard,
  ListTree,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@ledgernest/shared';

export interface NavItem {
  to: string;
  /** Translation key, e.g. nav.items.dashboard */
  labelKey: string;
  icon: LucideIcon;
  /** Shown only if the user has this permission */
  permission?: Permission;
  /** Built yet? Unbuilt items open the roadmap page */
  ready?: boolean;
  /** Match the path exactly (for items that are a prefix of others) */
  end?: boolean;
  /** Extra words for the command palette search */
  keywords?: string;
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    labelKey: 'nav.groups.overview',
    items: [{ to: '/', labelKey: 'nav.items.dashboard', icon: LayoutDashboard, ready: true, keywords: 'home summary kpi' }],
  },
  {
    labelKey: 'nav.groups.accounting',
    items: [
      { to: '/accounts', labelKey: 'nav.items.accounts', icon: ListTree, permission: 'accounts.view', ready: true, keywords: 'coa ledger codes chart sub-accounts' },
      { to: '/periods', labelKey: 'nav.items.periods', icon: CalendarRange, permission: 'accounts.view', ready: true, keywords: 'financial year fiscal period month close lock' },
      { to: '/journals', labelKey: 'nav.items.journals', icon: BookOpen, permission: 'journals.view', keywords: 'debit credit posting' },
      { to: '/reports', labelKey: 'nav.items.reports', icon: BarChart3, permission: 'reports.view', keywords: 'profit loss balance sheet trial' },
    ],
  },
  {
    labelKey: 'nav.groups.sales',
    items: [
      { to: '/invoices', labelKey: 'nav.items.invoices', icon: FileText, permission: 'invoices.view', keywords: 'sales customers receivables' },
      { to: '/bills', labelKey: 'nav.items.bills', icon: Receipt, permission: 'bills.view', keywords: 'vendors payables purchases' },
      { to: '/banking', labelKey: 'nav.items.banking', icon: Landmark, permission: 'banking.view', keywords: 'bank reconcile statement' },
      { to: '/transactions', labelKey: 'nav.items.payments', icon: ArrowLeftRight, permission: 'banking.view', keywords: 'receipts payments transfers' },
    ],
  },
  {
    labelKey: 'nav.groups.organisation',
    items: [
      { to: '/users', labelKey: 'nav.items.users', icon: Users, permission: 'users.view', ready: true, keywords: 'team invite permissions roles members' },
      { to: '/audit', labelKey: 'nav.items.audit', icon: ScrollText, permission: 'audit.view', ready: true, keywords: 'history activity log changes export' },
      { to: '/settings', labelKey: 'nav.items.settings', icon: Settings, permission: 'org.settings.view', ready: true, keywords: 'company fiscal year currency tax logo address time zone gstin vat' },
    ],
  },
  {
    labelKey: 'nav.groups.platform',
    items: [
      { to: '/platform', labelKey: 'nav.items.platformOverview', icon: Gauge, permission: 'platform.organizations.view', ready: true, end: true, keywords: 'super admin stats console' },
      { to: '/platform/organizations', labelKey: 'nav.items.organizations', icon: Building2, permission: 'platform.organizations.view', ready: true, keywords: 'tenants companies super admin' },
      { to: '/platform/users', labelKey: 'nav.items.platformUsers', icon: ShieldCheck, permission: 'platform.users.view', ready: true, keywords: 'super admin accounts' },
      { to: '/platform/audit', labelKey: 'nav.items.platformAudit', icon: History, permission: 'platform.audit.view', ready: true, keywords: 'super admin history sign-ins security log' },
    ],
  },
];

/** The navigation a user with these permissions may see (empty groups removed). */
export const visibleNav = (permissions: ReadonlySet<Permission>): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.has(i.permission)) })).filter((g) => g.items.length);
