import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { contactCreateSchema, contactStateCode, type ContactAddress, type ContactUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const select = {
  id: true,
  name: true,
  isCustomer: true,
  isVendor: true,
  legalName: true,
  taxId: true,
  email: true,
  phone: true,
  billingAddress: true,
  shippingAddress: true,
  stateCode: true,
  currency: true,
  paymentTermsDays: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
type Row = Prisma.ContactGetPayload<{ select: typeof select }>;
type Values = {
  name: string;
  isCustomer: boolean;
  isVendor: boolean;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: ContactAddress;
  shippingAddress: ContactAddress | null;
  currency: string | null;
  paymentTermsDays: number;
  notes: string | null;
};

const EDITABLE = ['name', 'isCustomer', 'isVendor', 'legalName', 'taxId', 'email', 'phone', 'billingAddress', 'shippingAddress', 'currency', 'paymentTermsDays', 'notes'] as const;

/** Customers and vendors. Names are unique per organisation (ignoring case); a contact in use is archived, not deleted. */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contacts:' + organizationId}))`;
  }

  private view(c: Row) {
    return { ...c, billingAddress: c.billingAddress as ContactAddress, shippingAddress: c.shippingAddress as ContactAddress | null, archived: !!c.archivedAt };
  }

  private async find(tx: Tx | PrismaService, organizationId: string, id: string) {
    const c = await tx.contact.findFirst({ where: { id, organizationId }, select });
    if (!c) throw new NotFoundException('Contact not found.');
    return c;
  }

  async list(organizationId: string, q: { search?: string; type?: 'customer' | 'vendor'; archived: boolean; page: number; pageSize: number }) {
    const where: Prisma.ContactWhereInput = {
      organizationId,
      archivedAt: q.archived ? { not: null } : null,
      ...(q.type === 'customer' && { isCustomer: true }),
      ...(q.type === 'vendor' && { isVendor: true }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { legalName: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
          { taxId: { contains: q.search.toUpperCase() } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => this.view(r)) };
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  /** The checks a whole contact must pass: a unique name, an enabled currency, and the GSTIN rules. */
  private async check(tx: Tx, organizationId: string, v: Values, exceptId?: string) {
    if (await tx.contact.findFirst({ where: { organizationId, name: { equals: v.name, mode: 'insensitive' }, ...(exceptId && { NOT: { id: exceptId } }) }, select: { id: true } })) {
      throw refuse(ConflictException, 'Another contact already has this name.', 'name_taken', { field: 'name' });
    }
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
    // The base currency is stored as "no currency"
    const currency = v.currency === org.baseCurrency ? null : v.currency;
    if (currency && !(await tx.organizationCurrency.findUnique({ where: { organizationId_code: { organizationId, code: currency } } }))) {
      throw refuse(BadRequestException, `Enable ${currency} under Currencies first.`, 'currency_not_enabled', { field: 'currency' });
    }
    const whole = contactCreateSchema.safeParse(v);
    if (!whole.success) {
      const issue = whole.error.issues[0]!;
      throw new BadRequestException({ message: issue.message, details: { reason: 'invalid', field: issue.path.join('.') } });
    }
    return { ...v, currency, stateCode: contactStateCode(v) };
  }

  private data(v: Values & { stateCode: string | null }) {
    return { ...v, billingAddress: v.billingAddress as Prisma.InputJsonValue, shippingAddress: v.shippingAddress === null ? Prisma.DbNull : (v.shippingAddress as Prisma.InputJsonValue) };
  }

  async create(input: Values, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const v = await this.check(tx, organizationId, input);
      const c = await tx.contact.create({ data: { organizationId, ...this.data(v) }, select });
      await this.audit.record({ action: 'org.contact.create', actorId: ctx.actor.userId, organizationId, entityType: 'contact', entityId: c.id, after: { name: c.name, isCustomer: c.isCustomer, isVendor: c.isVendor, taxId: c.taxId, currency: c.currency }, req: ctx.req }, tx);
      return this.view(c);
    });
  }

  async update(id: string, input: ContactUpdateInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = this.view(await this.find(tx, organizationId, id));
      const merged = { ...Object.fromEntries(EDITABLE.map((k) => [k, current[k]])), ...input } as Values;
      const changed = EDITABLE.filter((k) => k in input && JSON.stringify(merged[k]) !== JSON.stringify(current[k]));
      if (!changed.length) return current;
      const v = await this.check(tx, organizationId, merged, id);
      const data = this.data(v);
      const c = await tx.contact.update({ where: { id }, data: { ...Object.fromEntries(changed.map((k) => [k, data[k]])), stateCode: v.stateCode }, select });
      await this.audit.record(
        { action: 'org.contact.update', actorId: ctx.actor.userId, organizationId, entityType: 'contact', entityId: id, before: Object.fromEntries(changed.map((k) => [k, current[k]])), after: Object.fromEntries(changed.map((k) => [k, v[k]])), req: ctx.req },
        tx,
      );
      return this.view(c);
    });
  }

  async archive(id: string, archive: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (archive === !!c.archivedAt) throw refuse(ConflictException, archive ? 'This contact is already archived.' : 'This contact isn’t archived.', archive ? 'already_archived' : 'not_archived');
      const updated = await tx.contact.update({ where: { id }, data: { archivedAt: archive ? new Date() : null }, select });
      await this.audit.record({ action: archive ? 'org.contact.archive' : 'org.contact.restore', actorId: ctx.actor.userId, organizationId, entityType: 'contact', entityId: id, after: { name: c.name }, req: ctx.req }, tx);
      return this.view(updated);
    });
  }

  /** Deletes a contact nothing refers to yet; once invoices or bills use it, it can only be archived. */
  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (await tx.invoice.count({ where: { organizationId, contactId: id } })) throw refuse(ConflictException, 'Invoices are made out to this contact. Archive it instead.', 'in_use');
      await tx.contact.delete({ where: { id } });
      await this.audit.record({ action: 'org.contact.delete', actorId: ctx.actor.userId, organizationId, entityType: 'contact', entityId: id, before: { name: c.name }, req: ctx.req }, tx);
    });
  }
}
