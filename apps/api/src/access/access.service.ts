import { Injectable } from '@nestjs/common';
import { ORGANIZATION_PERMISSIONS, isBuiltInRole } from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { membershipPermissions } from './membership-permissions.js';
import type { Actor, Tenant } from './types.js';

export type ResolvedAccess = Tenant & {
  organizationStatus: 'ACTIVE' | 'SUSPENDED';
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
        select: { id: true, name: true, status: true },
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
      return { ...base, role, permissions, supportAccess: false };
    }

    if (actor.isSuperAdmin)
      return {
        ...base,
        role: { type: 'support' },
        permissions: new Set(ORGANIZATION_PERMISSIONS),
        supportAccess: true,
      };
    return null;
  }
}
