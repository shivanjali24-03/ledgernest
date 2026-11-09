import {
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission } from '@ledgernest/shared';
import type { AccessRequest, Actor, Tenant } from './types.js';

export const IS_PUBLIC = 'ln:isPublic';
export const REQUIRED_PERMISSIONS = 'ln:requiredPermissions';

/** Opens an endpoint to signed-out callers. Everything else requires sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The caller must hold every listed permission.
 * - Organisation permissions (e.g. `journals.post`) need an `X-Organization-Id` header,
 *   and scope all data access in the request to that organisation.
 * - Platform permissions (`platform.*`) are for Super Admins only.
 * Don't mix the two kinds in one decorator.
 */
export const RequirePermission = (
  ...permissions: [Permission, ...Permission[]]
) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** The signed-in user (set by the auth guard). */
export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor => {
    const actor = ctx.switchToHttp().getRequest<AccessRequest>().actor;
    if (!actor) throw new UnauthorizedException('Please sign in.');
    return actor;
  },
);

/** The organisation this request acts in, and the caller's access there (set by the permission guard). */
export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Tenant => {
    const tenant = ctx.switchToHttp().getRequest<AccessRequest>().tenant;
    if (!tenant)
      throw new Error(
        'No organisation for this endpoint: add @RequirePermission with an organisation permission.',
      );
    return tenant;
  },
);
