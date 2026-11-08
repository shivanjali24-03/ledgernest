import type { OrganizationCreateInput, OrganizationUpdateInput } from '@ledgernest/shared';

export type Status = 'ACTIVE' | 'SUSPENDED';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: Status;
  baseCurrency: string;
  locale: string;
  country: string | null;
  fiscalYearStartMonth: number;
  createdAt: string;
}

export interface OrganizationRow extends Organization {
  memberCount: number;
}

export interface OrganizationDetail extends OrganizationRow {
  owners: { id: string; name: string; email: string }[];
  pendingInvitations: { id: string; email: string; builtInRole: string | null; expiresAt: string; createdAt: string }[];
}

export type OwnerResult = { status: 'added'; userId: string } | { status: 'invited'; email: string; inviteUrl: string; expiresAt: string };

export interface CreateOrganizationResult {
  organization: Organization;
  owner: OwnerResult;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  status: Status;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  organizationCount: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  createdAt: string;
  entityType: string | null;
  entityId: string | null;
  actor: { name: string; email: string } | null;
  organization: { id: string; name: string } | null;
}

export interface PlatformStats {
  organizations: { total: number; active: number; suspended: number; newLast30Days: number };
  users: { total: number; active: number; suspended: number; superAdmins: number };
  activity: { signInsLast7Days: number; failedSignInsLast7Days: number };
  recent: ActivityItem[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListQuery {
  search?: string;
  status?: Status;
  page?: number;
  pageSize?: number;
}

export type UserAction = 'promote' | 'demote' | 'suspend' | 'reactivate';

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: { type: 'built_in'; key: string } | { type: 'custom'; name?: string };
  accountExists: boolean;
  expiresAt: string;
}

/** Everything the Super Admin console and the invitation page need. Live and demo both implement it. */
export interface PlatformApi {
  stats(): Promise<PlatformStats>;
  listOrganizations(q: ListQuery): Promise<Page<OrganizationRow>>;
  getOrganization(id: string): Promise<OrganizationDetail>;
  createOrganization(input: OrganizationCreateInput): Promise<CreateOrganizationResult>;
  updateOrganization(id: string, input: OrganizationUpdateInput): Promise<Organization>;
  setOrganizationStatus(id: string, action: 'suspend' | 'reactivate', reason?: string): Promise<Organization>;
  listUsers(q: ListQuery & { superAdmin?: boolean }): Promise<Page<PlatformUser>>;
  userAction(id: string, action: UserAction, reason?: string): Promise<PlatformUser>;
  previewInvitation(token: string): Promise<InvitationPreview>;
  acceptInvitationSignedIn(token: string): Promise<{ organizationId: string; organizationName: string }>;
}
