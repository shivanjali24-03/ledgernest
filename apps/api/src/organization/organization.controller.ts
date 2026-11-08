import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Tenant } from '../access/types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('organization')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'The organisation to act in' })
@Controller('organization')
export class OrganizationController {
  constructor(private readonly prisma: PrismaService) {}

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
}
