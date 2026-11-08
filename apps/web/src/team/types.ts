import type { BuiltInRoleId, CustomRoleInput, OrganizationPermission, RoleChoice } from '@ledgernest/shared';

export type MemberRole = { type: 'built_in'; key: string } | { type: 'custom'; id?: string; name?: string };

export interface Member {
  id: string;
  user: { id: string; name: string; email: string; status: 'ACTIVE' | 'SUSPENDED'; lastLoginAt: string | null };
  role: MemberRole;
  joinedAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface InviteResult {
  id: string;
  email: string;
  inviteUrl: string;
  expiresAt: string;
  accountExists?: boolean;
}

export interface BuiltInRoleRow {
  type: 'built_in';
  key: Exclude<BuiltInRoleId, 'super_admin'>;
  permissions: OrganizationPermission[];
  memberCount: number;
  canAssign: boolean;
}

export interface CustomRoleRow {
  type: 'custom';
  id: string;
  name: string;
  description: string | null;
  permissions: OrganizationPermission[];
  memberCount: number;
  canAssign: boolean;
}

export interface RolesResponse {
  builtIn: BuiltInRoleRow[];
  custom: CustomRoleRow[];
}

/** An organisation's team management. Live and demo both implement it. */
export interface TeamApi {
  listMembers(): Promise<Member[]>;
  changeRole(memberId: string, role: RoleChoice): Promise<unknown>;
  removeMember(memberId: string): Promise<void>;
  listInvitations(): Promise<PendingInvitation[]>;
  invite(email: string, role: RoleChoice): Promise<InviteResult>;
  resend(invitationId: string): Promise<InviteResult>;
  revoke(invitationId: string): Promise<void>;
  listRoles(): Promise<RolesResponse>;
  createRole(input: CustomRoleInput): Promise<unknown>;
  updateRole(id: string, input: Partial<CustomRoleInput>): Promise<unknown>;
  deleteRole(id: string): Promise<void>;
}
