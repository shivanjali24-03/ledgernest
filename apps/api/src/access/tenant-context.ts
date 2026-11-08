import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface TenantStore {
  organizationId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

/** Gives every request its own empty store; the permission guard fills in the organisation. */
export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  storage.run({}, next);
}

export function setCurrentOrganization(organizationId: string) {
  const store = storage.getStore();
  if (!store) throw new Error('Tenant context missing: is tenantContextMiddleware installed?');
  store.organizationId = organizationId;
}

/** The organisation for this request. Throws (fails closed) when there is none. */
export function currentOrganizationId(): string {
  const id = storage.getStore()?.organizationId;
  if (!id) throw new Error('No organisation in context. Organisation data can only be used behind @RequirePermission with an organisation permission.');
  return id;
}

/**
 * Runs `fn` as if inside a request for `organizationId`. For jobs, seeds and tests.
 * The result is awaited inside the context: Prisma queries are lazy and only run when awaited,
 * so returning one un-awaited would run it outside the organisation (and fail closed).
 */
export const runInOrganization = <T>(organizationId: string, fn: () => T | PromiseLike<T>): Promise<T> =>
  storage.run({ organizationId }, async () => await fn());
