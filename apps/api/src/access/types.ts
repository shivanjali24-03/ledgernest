import type { BuiltInRoleId, OrganizationPermission } from '@ledgernest/shared';
import type { Request } from 'express';

/** The signed-in user, freshly loaded from the database on every request. */
export interface Actor {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  /** Two-factor sign-in is on for this person */
  twoFactor?: boolean;
  /** Set when the call comes with an API key: it acts for the person who made it, in its organisation, within its scopes */
  apiKey?: {
    id: string;
    name: string;
    prefix: string;
    organizationId: string;
    scopes: ReadonlySet<OrganizationPermission>;
  };
}

/** Where the request acts and what the caller may do there. */
export interface Tenant {
  organizationId: string;
  organizationName: string;
  role:
    | { type: 'built_in'; key: BuiltInRoleId }
    | { type: 'custom'; id: string; name: string }
    | { type: 'support' };
  permissions: ReadonlySet<OrganizationPermission>;
  /** A Super Admin acting in an organisation they don't belong to. Always audited. */
  supportAccess: boolean;
}

export type AccessRequest = Request & { actor?: Actor; tenant?: Tenant };
