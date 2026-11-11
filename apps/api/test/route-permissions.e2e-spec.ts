import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { AppModule } from '../src/app.module.js';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/access/decorators.js';
import { setupApp } from '../src/setup-app.js';

/**
 * The permission guard lets any signed-in person through a route that names no permission. That's right only
 * for a few routes about the person themselves; this keeps a forgotten decorator from opening anything else.
 */
const SIGNED_IN_ONLY = new Set([
  // Your own session, password, two-factor and sessions
  'AuthController.me',
  'AuthController.twoFactorStatus',
  'AuthController.twoFactorSetup',
  'AuthController.twoFactorEnable',
  'AuthController.twoFactorDisable',
  'AuthController.twoFactorRecoveryCodes',
  'AuthController.changePassword',
  'AuthController.deleteAccount',
  'AuthController.listSessions',
  'AuthController.logoutAll',
  'AuthController.revokeSession',
  // Looking up a PIN code or IFSC: public reference data, rate limited
  'GeoController.ifsc',
  'GeoController.pincode',
  // Accepting an invitation addressed to you while signed in
  'InvitationsController.acceptSignedIn',
]);

describe('Every route names its permission (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
  });
  afterAll(() => app.close());

  it('has no route open to every signed-in person except the known ones', () => {
    const reflector = app.get(Reflector);
    const open: string[] = [];
    for (const m of app.get(ModulesContainer).values())
      for (const c of m.controllers.values()) {
        const cls = c.metatype as unknown as {
          name: string;
          prototype: Record<string, unknown>;
        } | null;
        if (!cls) continue;
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          const handler = cls.prototype[name];
          if (
            name === 'constructor' ||
            typeof handler !== 'function' ||
            Reflect.getMetadata(PATH_METADATA, handler) === undefined
          )
            continue;
          const targets = [handler as () => void, cls as unknown as () => void];
          const permissions = reflector.getAllAndOverride<string[] | undefined>(
            REQUIRED_PERMISSIONS,
            targets,
          );
          const isPublic = reflector.getAllAndOverride<boolean | undefined>(
            IS_PUBLIC,
            targets,
          );
          if (!permissions?.length && !isPublic)
            open.push(`${cls.name}.${name}`);
        }
      }
    expect(open.filter((r) => !SIGNED_IN_ONLY.has(r)).sort()).toEqual([]);
  });
});
