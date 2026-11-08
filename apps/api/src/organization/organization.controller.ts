import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequirePermission } from '../access/decorators.js';
import { TenantPrisma } from '../access/tenant-prisma.js';
import type { Tenant } from '../access/types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('organization')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrisma,
  ) {}

  /** The current organisation, and the caller's role and permissions in it. */
  @Get()
  @RequirePermission('org.settings.view')
  @ApiOkResponse({ description: 'Organisation details and your access' })
  async current(@CurrentTenant() tenant: Tenant) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { id: true, name: true, slug: true, status: true, baseCurrency: true, locale: true, country: true, fiscalYearStartMonth: true, createdAt: true },
    });
    return {
      organization: org,
      access: { role: tenant.role, permissions: [...tenant.permissions], supportAccess: tenant.supportAccess },
    };
  }

  /** People in the current organisation. Scoped automatically: other organisations' members can't appear. */
  @Get('members')
  @RequirePermission('users.view')
  @ApiOkResponse({ description: 'Members with their roles' })
  async members() {
    const rows = await this.tenantPrisma.db.membership.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        builtInRole: true,
        createdAt: true,
        customRole: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      user: m.user,
      role: m.builtInRole ? { type: 'built_in', key: m.builtInRole } : { type: 'custom', id: m.customRole?.id, name: m.customRole?.name },
      joinedAt: m.createdAt,
    }));
  }
}
