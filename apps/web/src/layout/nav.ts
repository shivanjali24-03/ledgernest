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
  label: string;
  icon: LucideIcon;
  /** Shown only if the user has this permission */
  permission?: Permission;
  /** Built yet? Unbuilt items open the roadmap page */
  ready?: boolean;
  /** Extra words for the command palette search */
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, ready: true, keywords: 'home summary kpi' }],
  },
  {
    label: 'Accounting',
    items: [
      { to: '/accounts', label: 'Chart of accounts', icon: ListTree, permission: 'accounts.view', keywords: 'coa ledger codes' },
      { to: '/journals', label: 'Journal entries', icon: BookOpen, permission: 'journals.view', keywords: 'debit credit posting' },
      { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports.view', keywords: 'profit loss balance sheet trial' },
    ],
  },
  {
    label: 'Sales & purchases',
    items: [
      { to: '/invoices', label: 'Invoices', icon: FileText, permission: 'invoices.view', keywords: 'sales customers receivables' },
      { to: '/bills', label: 'Bills', icon: Receipt, permission: 'bills.view', keywords: 'vendors payables purchases' },
      { to: '/banking', label: 'Banking', icon: Landmark, permission: 'banking.view', keywords: 'bank reconcile statement' },
      { to: '/transactions', label: 'Payments', icon: ArrowLeftRight, permission: 'banking.view', keywords: 'receipts payments transfers' },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { to: '/users', label: 'Users & roles', icon: Users, permission: 'users.view', keywords: 'team invite permissions' },
      { to: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view', keywords: 'history activity' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'org.settings.view', keywords: 'company fiscal year currency tax' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/platform/organizations', label: 'Organisations', icon: Building2, permission: 'platform.organizations.view', keywords: 'tenants companies super admin' },
      { to: '/platform/users', label: 'Platform users', icon: ShieldCheck, permission: 'platform.users.view', keywords: 'super admin accounts' },
    ],
  },
];

/** The navigation a user with these permissions may see (empty groups removed). */
export const visibleNav = (permissions: ReadonlySet<Permission>): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.has(i.permission)) })).filter((g) => g.items.length);
