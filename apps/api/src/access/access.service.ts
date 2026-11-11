import { platformTwoFactorRequired } from './platform-2fa.js';
import { Injectable } from '@nestjs/common';
import { ORGANIZATION_PERMISSIONS, isBuiltInRole } from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { membershipPermissions } from './membership-permissions.js';
import type { Actor, Tenant } from './types.js';

export type ResolvedAccess = Tenant & {
  organizationStatus: 'ACTIVE' | 'SUSPENDED';
  /** The organisation requires two-factor sign-in and this member hasn't turned it on */
  twoFactorMissing?: boolean;
};

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's access to one organisation, or null if they have none.
   * Members get their role's permissions. A Super Admin who isn't a member gets support access.
   */
  async resolve(
    actor: Actor,
    organizationId: string,
  ): Promise<ResolvedAccess | null> {
    const [org, membership] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, status: true, requireTwoFactor: true },
      }),
      this.prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: actor.userId, organizationId },
        },
        include: {
          customRole: { select: { id: true, name: true, permissions: true } },
        },
      }),
    ]);
    if (!org) return null;

    const base = {
      organizationId: org.id,
      organizationName: org.name,
      organizationStatus: org.status,
    };

    if (membership) {
      const role: Tenant['role'] =
        membership.builtInRole && isBuiltInRole(membership.builtInRole)
          ? { type: 'built_in', key: membership.builtInRole }
          : {
              type: 'custom',
              id: membership.customRole?.id ?? '',
              name: membership.customRole?.name ?? '',
            };
      const permissions = actor.isSuperAdmin
        ? new Set(ORGANIZATION_PERMISSIONS)
        : membershipPermissions(membership);
      const twoFactorMissing =
        org.requireTwoFactor &&
        !(
          await this.prisma.user.findUnique({
            where: { id: actor.userId },
            select: { totpEnabledAt: true },
          })
        )?.totpEnabledAt;
      return {
        ...base,
        role,
        permissions,
        supportAccess: false,
        twoFactorMissing,
      };
    }

    if (actor.isSuperAdmin)
      return {
        ...base,
        role: { type: 'support' },
        permissions: new Set(ORGANIZATION_PERMISSIONS),
        supportAccess: true,
        // Support access into any organisation: two-factor sign-in when the platform requires it, or the organisation does
        twoFactorMissing:
          (platformTwoFactorRequired() || org.requireTwoFactor) &&
          !actor.twoFactor,
      };
    return null;
  }
}
