import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarRange,
  Coins,
  Contact,
  Building2,
  FileMinus,
  FileText,
  Gauge,
  History,
  Landmark,
  LayoutDashboard,
  Package,
  Percent,
  ListTree,
  Monitor,
  Receipt,
  Repeat,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
  Target,
  Network,
  Boxes,
  UserCheck,
  FileUp,
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
      { to: '/fixed-assets', labelKey: 'nav.items.fixedAssets', icon: Monitor, permission: 'accounts.view', ready: true, keywords: 'fixed assets depreciation register equipment disposal' },
      { to: '/cost-centres', labelKey: 'nav.items.costCentres', icon: Network, permission: 'accounts.view', ready: true, keywords: 'cost centre center department branch project division segment' },
      { to: '/journals', labelKey: 'nav.items.journals', icon: BookOpen, permission: 'journals.view', ready: true, keywords: 'debit credit posting voucher jv reverse' },
      { to: '/taxes', labelKey: 'nav.items.taxes', icon: Percent, permission: 'accounts.view', ready: true, keywords: 'gst vat sales tax cgst sgst igst utgst rates slabs' },
      { to: '/currencies', labelKey: 'nav.items.currencies', icon: Coins, permission: 'accounts.view', ready: true, keywords: 'foreign currency exchange rate usd eur forex fx ecb revalue' },
      { to: '/reports', labelKey: 'nav.items.reports', icon: BarChart3, permission: 'reports.view', ready: true, keywords: 'trial balance general ledger profit loss balance sheet' },
      { to: '/budgets', labelKey: 'nav.items.budgets', icon: Target, permission: 'reports.view', ready: true, keywords: 'budget plan forecast target variance actual' },
    ],
  },
  {
    labelKey: 'nav.groups.sales',
    items: [
      { to: '/contacts', labelKey: 'nav.items.contacts', icon: Contact, permission: 'contacts.view', ready: true, keywords: 'customers vendors suppliers clients gstin parties' },
      { to: '/items', labelKey: 'nav.items.items', icon: Package, permission: 'invoices.view', ready: true, keywords: 'products services catalogue price list sku hsn sac' },
      { to: '/inventory', labelKey: 'nav.items.inventory', icon: Boxes, permission: 'reports.view', ready: true, keywords: 'inventory stock on hand valuation average cost warehouse goods adjustment write off' },
      { to: '/invoices', labelKey: 'nav.items.invoices', icon: FileText, permission: 'invoices.view', ready: true, keywords: 'sales customers receivables bill gst tax invoice' },
      { to: '/recurring', labelKey: 'nav.items.recurring', icon: Repeat, permission: 'invoices.view', ready: true, keywords: 'recurring repeat subscription schedule retainer monthly' },
      { to: '/credit-notes', labelKey: 'nav.items.creditNotes', icon: FileMinus, permission: 'invoices.view', ready: true, keywords: 'credit note refund return correction cn' },
      { to: '/bills', labelKey: 'nav.items.bills', icon: Receipt, permission: 'bills.view', ready: true, keywords: 'vendors suppliers payables purchases expenses input gst' },
      { to: '/banking', labelKey: 'nav.items.banking', icon: Landmark, permission: 'banking.view', ready: true, keywords: 'bank cash reconcile statement transfer spend receive money' },
      { to: '/payments', labelKey: 'nav.items.payments', icon: ArrowLeftRight, permission: 'invoices.view', ready: true, keywords: 'receipts payments money received collections bank' },
    ],
  },
  {
    labelKey: 'nav.groups.organisation',
    items: [
      { to: '/users', labelKey: 'nav.items.users', icon: Users, permission: 'users.view', ready: true, keywords: 'team invite permissions roles members' },
      { to: '/approvals', labelKey: 'nav.items.approvals', icon: UserCheck, permission: 'journals.view', ready: true, keywords: 'approval approve maker checker sign off authorise authorize send back pending' },
      { to: '/audit', labelKey: 'nav.items.audit', icon: ScrollText, permission: 'audit.view', ready: true, keywords: 'history activity log changes export' },
      { to: '/imports', labelKey: 'nav.items.imports', icon: FileUp, permission: 'org.settings.view', ready: true, keywords: 'import spreadsheet csv excel xlsx upload chart of accounts contacts items opening balances migrate tally' },
      { to: '/settings', labelKey: 'nav.items.settings', icon: Settings, permission: 'org.settings.view', ready: true, keywords: 'company fiscal year currency tax logo address time zone gstin vat' },
    ],
  },
  {
    labelKey: 'nav.groups.platform',
    items: [
      { to: '/platform', labelKey: 'nav.items.platformOverview', icon: Gauge, permission: 'platform.organizations.view', ready: true, end: true, keywords: 'super admin stats console' },
      { to: '/platform/organizations', labelKey: 'nav.items.organizations', icon: Building2, permission: 'platform.organizations.view', ready: true, keywords: 'tenants companies super admin' },
      { to: '/platform/users', labelKey: 'nav.items.platformUsers', icon: ShieldCheck, permission: 'platform.users.view', ready: true, keywords: 'super admin accounts' },
      { to: '/platform/gst-slabs', labelKey: 'nav.items.gstSlabs', icon: Percent, permission: 'platform.settings.manage', ready: true, keywords: 'super admin gst slabs rates india council' },
      { to: '/platform/audit', labelKey: 'nav.items.platformAudit', icon: History, permission: 'platform.audit.view', ready: true, keywords: 'super admin history sign-ins security log' },
    ],
  },
];

/** The navigation a user with these permissions may see (empty groups removed). */
export const visibleNav = (permissions: ReadonlySet<Permission>): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.has(i.permission)) })).filter((g) => g.items.length);
