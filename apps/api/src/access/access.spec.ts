import { readFileSync } from 'node:fs';
import { BUILT_IN_ROLES } from '@ledgernest/shared';
import { membershipPermissions } from './membership-permissions.js';
import { currentOrganizationId, runInOrganization } from './tenant-context.js';
import { TENANT_EXEMPT, TENANT_MODELS, scopeArgs } from './tenant-prisma.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('scopeArgs', () => {
  it('adds the organisation to reads, updates and deletes', () => {
    for (const op of [
      'findMany',
      'findFirst',
      'findUnique',
      'count',
      'updateMany',
      'update',
      'delete',
      'deleteMany',
      'aggregate',
      'groupBy',
    ]) {
      expect(scopeArgs(op, { where: { name: 'x' } }, A).where).toEqual({
        name: 'x',
        organizationId: A,
      });
    }
  });

  it('works when there is no where at all', () => {
    expect(scopeArgs('findMany', {}, A).where).toEqual({ organizationId: A });
  });

  it("can't be overridden by the caller asking for another organisation", () => {
    expect(
      scopeArgs('findMany', { where: { organizationId: B } }, A).where,
    ).toEqual({ organizationId: A });
    expect(
      scopeArgs('create', { data: { name: 'x', organizationId: B } }, A).data,
    ).toEqual({ name: 'x', organizationId: A });
  });

  it('stamps every created row', () => {
    expect(
      scopeArgs('createMany', { data: [{ n: 1 }, { n: 2 }] }, A).data,
    ).toEqual([
      { n: 1, organizationId: A },
      { n: 2, organizationId: A },
    ]);
    const up = scopeArgs('upsert', { where: { id: '1' }, create: { n: 1 } }, A);
    expect(up.where).toEqual({ id: '1', organizationId: A });
    expect(up.create).toEqual({ n: 1, organizationId: A });
  });
});

describe('tenant context', () => {
  it('fails closed outside an organisation', () => {
    expect(() => currentOrganizationId()).toThrow(/No organisation in context/);
  });

  it('knows the organisation inside one, including after awaits', async () => {
    const seen = await runInOrganization(A, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentOrganizationId();
    });
    expect(seen).toBe(A);
  });
});

describe('every organisation-owned table is protected', () => {
  it('each model with an organizationId column is auto-scoped or explicitly exempt', () => {
    const schema = readFileSync(
      new URL('../../prisma/schema.prisma', import.meta.url),
      'utf8',
    );
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+organizationId\s/m.test(body!))
      .map(([, name]) => name!);

    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(
        TENANT_MODELS.has(m) || m in TENANT_EXEMPT,
        `${m} has organizationId: add it to TENANT_MODELS (or TENANT_EXEMPT with a reason)`,
      ).toBe(true);
    }
  });
});

describe('membershipPermissions', () => {
  it('uses the built-in role', () => {
    expect([
      ...membershipPermissions({ builtInRole: 'viewer', customRole: null }),
    ]).toEqual(BUILT_IN_ROLES.viewer.permissions);
  });

  it('never grants platform permissions through a membership', () => {
    const fromCustom = membershipPermissions({
      builtInRole: null,
      customRole: {
        permissions: [
          'users.view',
          'platform.users.manage',
          'not.a.permission',
        ],
      },
    });
    expect([...fromCustom]).toEqual(['users.view']);
    const fromSuperAdminKey = membershipPermissions({
      builtInRole: 'super_admin',
      customRole: null,
    });
    expect([...fromSuperAdminKey].some((p) => p.startsWith('platform.'))).toBe(
      false,
    );
  });
});
