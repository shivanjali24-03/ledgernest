import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  isPlatformPermission,
  type OrganizationPermission,
  type Permission,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from './access.service.js';
import { REQUIRED_PERMISSIONS } from './decorators.js';
import { setCurrentOrganization } from './tenant-context.js';
import type { AccessRequest } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ORG_HEADER = 'x-organization-id';

/** Global: enforces @RequirePermission and pins the request to one organisation. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<AccessRequest>();
    const actor = req.actor;
    if (!actor)
      throw new Error('@RequirePermission used on a @Public() endpoint');

    const platform = required.filter(isPlatformPermission);
    if (platform.length && platform.length !== required.length)
      throw new Error(
        '@RequirePermission mixes platform and organisation permissions',
      );

    // Platform endpoints: Super Admin only (never with an API key)
    if (platform.length && actor.apiKey)
      throw new ForbiddenException('API keys can’t do this.');
    if (platform.length) {
      if (!actor.isSuperAdmin)
        throw new ForbiddenException('Only a Super Admin can do this.');
      return true;
    }

    // Organisation endpoints; an API key works in its own organisation only
    const organizationId =
      req.header(ORG_HEADER) ?? actor.apiKey?.organizationId;
    if (actor.apiKey && organizationId !== actor.apiKey.organizationId)
      throw new NotFoundException('Organisation not found.');
    if (!organizationId || !UUID.test(organizationId)) {
      throw new BadRequestException(
        'Choose an organisation: send its id in the X-Organization-Id header.',
      );
    }

    const access = await this.access.resolve(actor, organizationId);
    // "Not found" rather than "forbidden": outsiders can't tell whether an organisation exists
    if (!access) throw new NotFoundException('Organisation not found.');
    if (access.organizationStatus === 'SUSPENDED' && !actor.isSuperAdmin)
      throw new ForbiddenException('This organisation is suspended.');

    // The organisation requires two-factor sign-in: set it up first (API keys act for a person already checked)
    if (access.twoFactorMissing && !actor.apiKey)
      throw new ForbiddenException({
        message:
          'This organisation requires two-factor sign-in. Turn it on for your account to continue.',
        details: { reason: 'two_factor_required' },
      });

    // A key may do what its maker may do now, and only within its scopes
    if (actor.apiKey) {
      const scopes = actor.apiKey.scopes;
      access.permissions = new Set(
        [...access.permissions].filter(
          (p) => p === 'org.settings.view' || scopes.has(p),
        ),
      );
    }
    const missing = (required as OrganizationPermission[]).filter(
      (p) => !access.permissions.has(p),
    );
    if (missing.length)
      throw new ForbiddenException({
        message: actor.apiKey
          ? 'This API key isn’t allowed to do this.'
          : 'Your role does not allow this.',
        details: { missing },
      });

    const {
      organizationStatus: _status,
      twoFactorMissing: _missing,
      ...tenant
    } = access;
    req.tenant = tenant;
    setCurrentOrganization(organizationId);

    if (access.supportAccess) {
      await this.prisma.auditLog.create({
        data: {
          action: 'platform.support_access',
          organizationId,
          actorId: actor.userId,
          entityType: 'organization',
          entityId: organizationId,
          after: {
            method: req.method,
            path: req.originalUrl,
            permissions: required,
          },
          ip: req.ip,
          userAgent: req.headers['user-agent']?.slice(0, 255),
        },
      });
    }
    return true;
  }
}
