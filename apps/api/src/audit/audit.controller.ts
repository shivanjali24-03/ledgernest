import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditQuery } from '@ledgernest/shared';
import type { Request, Response } from 'express';
import { CurrentActor, CurrentTenant, RequirePermission } from '../access/decorators.js';
import type { Actor, Tenant } from '../access/types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuditQueryService, type AuditFilter } from './audit-query.service.js';
import { AuditService } from './audit.service.js';

const filters = new ZodValidationPipe(auditQuerySchema);
const today = () => new Date().toISOString().slice(0, 10);

function queryDocs() {
  return [
    ApiQuery({ name: 'group', required: false, description: 'signIns, members, invitations, roles, supportAccess, organizations, platformUsers, exports' }),
    ApiQuery({ name: 'actorId', required: false }),
    ApiQuery({ name: 'from', required: false, description: 'ISO timestamp' }),
    ApiQuery({ name: 'to', required: false, description: 'ISO timestamp' }),
    ApiQuery({ name: 'cursor', required: false, description: 'nextCursor from the previous page' }),
    ApiQuery({ name: 'limit', required: false }),
  ];
}
const apply =
  (...decorators: MethodDecorator[]): MethodDecorator =>
  (target, key, descriptor) => {
    for (const d of decorators) d(target, key, descriptor);
  };

/** An organisation's own audit log: changes to its team and roles, and every Super Admin support visit. */
@ApiTags('audit')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('organization/audit')
export class OrganizationAuditController {
  constructor(
    private readonly audit: AuditQueryService,
    private readonly writer: AuditService,
  ) {}

  @Get()
  @RequirePermission('audit.view')
  @apply(...queryDocs())
  @ApiOkResponse({ description: 'Newest first, 50 per page, with nextCursor' })
  list(@Query(filters) q: AuditQuery, @CurrentTenant() tenant: Tenant) {
    return this.audit.list(q as AuditFilter, { organizationId: tenant.organizationId });
  }

  @Get('export')
  @RequirePermission('audit.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @apply(...queryDocs())
  async export(@Query(filters) q: AuditQuery, @CurrentTenant() tenant: Tenant, @CurrentActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.audit.csv(q as AuditFilter, { organizationId: tenant.organizationId });
    await this.writer.record({ action: 'org.audit.export', actorId: actor.userId, organizationId: tenant.organizationId, after: { filters: { ...q, cursor: undefined }, rows: out.count }, req });
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${today()}.csv"`);
    if (out.truncated) res.setHeader('X-Truncated', 'true');
    return out.body;
  }
}

/** The whole platform's audit log, for Super Admins: sign-ins, platform changes and every organisation's history. */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('platform/audit')
export class PlatformAuditController {
  constructor(
    private readonly audit: AuditQueryService,
    private readonly writer: AuditService,
  ) {}

  @Get()
  @RequirePermission('platform.audit.view')
  @apply(...queryDocs(), ApiQuery({ name: 'organizationId', required: false }))
  @ApiOkResponse({ description: 'Newest first, 50 per page, with nextCursor' })
  list(@Query(filters) q: AuditQuery) {
    return this.audit.list(q as AuditFilter, {});
  }

  @Get('export')
  @RequirePermission('platform.audit.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @apply(...queryDocs(), ApiQuery({ name: 'organizationId', required: false }))
  async export(@Query(filters) q: AuditQuery, @CurrentActor() actor: Actor, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.audit.csv(q as AuditFilter, {});
    await this.writer.record({ action: 'platform.audit.export', actorId: actor.userId, organizationId: q.organizationId ?? null, after: { filters: { ...q, cursor: undefined }, rows: out.count }, req });
    res.setHeader('Content-Disposition', `attachment; filename="platform-audit-log-${today()}.csv"`);
    if (out.truncated) res.setHeader('X-Truncated', 'true');
    return out.body;
  }
}
