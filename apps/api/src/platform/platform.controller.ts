import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../access/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Platform-wide views. Super Admin only. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('organizations')
  @RequirePermission('platform.organizations.view')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ description: 'Every organisation, newest first, with member counts' })
  async organizations(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const [total, items] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, name: true, slug: true, status: true, baseCurrency: true, createdAt: true, _count: { select: { memberships: true } } },
      }),
    ]);
    return {
      items: items.map(({ _count, ...o }) => ({ ...o, memberCount: _count.memberships })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}
