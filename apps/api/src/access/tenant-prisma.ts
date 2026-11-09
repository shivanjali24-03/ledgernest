import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentOrganizationId } from './tenant-context.js';

/**
 * Models that belong to one organisation. Queries on them through `TenantPrisma` are scoped
 * automatically. A test fails if a model with an `organizationId` column is missing here
 * and not listed in TENANT_EXEMPT.
 */
export const TENANT_MODELS = new Set<string>(['Role', 'Membership', 'Invitation', 'OrganizationLogo', 'Account', 'FiscalYear', 'Period', 'JournalEntry', 'JournalLine', 'JournalAttachment', 'TaxRate', 'TaxGroup', 'TaxGroupRate', 'OrganizationCurrency', 'ExchangeRate', 'Contact', 'Item', 'Invoice', 'InvoiceLine', 'Payment', 'PaymentAllocation']);

/** Models with an organisationId that are deliberately not auto-scoped, and why. */
export const TENANT_EXEMPT: Record<string, string> = {
  AuditLog: 'Also records platform actions with no organisation; read through dedicated, permission-checked queries.',
};

type Args = { where?: object; data?: object | object[]; create?: object };

/** Adds the current organisation to every query on a tenant model. Fails closed when there is none. */
export function scopeArgs(operation: string, args: Args, organizationId: string): Args {
  const a: Args = { ...args };
  switch (operation) {
    case 'create':
      a.data = { ...(a.data as object), organizationId };
      break;
    case 'createMany':
    case 'createManyAndReturn':
      a.data = (Array.isArray(a.data) ? a.data : [a.data ?? {}]).map((d) => ({ ...d, organizationId }));
      break;
    case 'upsert':
      a.where = { ...a.where, organizationId };
      a.create = { ...a.create, organizationId };
      break;
    default:
      // find*, count, aggregate, groupBy, update*, delete*: our organisation always wins over any caller-supplied value
      a.where = { ...a.where, organizationId };
  }
  return a;
}

const scoped = (prisma: PrismaService) =>
  prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(scopeArgs(operation, args as Args, currentOrganizationId()) as typeof args);
        },
      },
    },
  });

/**
 * Database access for organisation data. Use this, not PrismaService, in anything org-scoped.
 * Note: only top-level queries are scoped; nested writes into tenant models must go through their own model.
 */
@Injectable()
export class TenantPrisma {
  readonly db: ReturnType<typeof scoped>;
  constructor(prisma: PrismaService) {
    this.db = scoped(prisma);
  }
}
