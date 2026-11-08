import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Building2,
  FileText,
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
      { to: '/accounts', labelKey: 'nav.items.accounts', icon: ListTree, permission: 'accounts.view', keywords: 'coa ledger codes' },
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
      { to: '/users', labelKey: 'nav.items.users', icon: Users, permission: 'users.view', keywords: 'team invite permissions' },
      { to: '/audit', labelKey: 'nav.items.audit', icon: ScrollText, permission: 'audit.view', keywords: 'history activity' },
      { to: '/settings', labelKey: 'nav.items.settings', icon: Settings, permission: 'org.settings.view', keywords: 'company fiscal year currency tax' },
    ],
  },
  {
    labelKey: 'nav.groups.platform',
    items: [
      { to: '/platform/organizations', labelKey: 'nav.items.organizations', icon: Building2, permission: 'platform.organizations.view', keywords: 'tenants companies super admin' },
      { to: '/platform/users', labelKey: 'nav.items.platformUsers', icon: ShieldCheck, permission: 'platform.users.view', keywords: 'super admin accounts' },
    ],
  },
];

/** The navigation a user with these permissions may see (empty groups removed). */
export const visibleNav = (permissions: ReadonlySet<Permission>): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.has(i.permission)) })).filter((g) => g.items.length);
