import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  contactCreateSchema,
  contactStateCode,
  type ContactAddress,
  type ContactUpdateInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { allPages, toCsv } from '../common/list-export.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });

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
  creditLimit: true,
  notes: true,
  archivedAt: true,
  shareToken: true,
  shareViews: true,
  shareViewedAt: true,
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
  creditLimit: number | null;
  notes: string | null;
};

const EDITABLE = [
  'name',
  'isCustomer',
  'isVendor',
  'legalName',
  'taxId',
  'email',
  'phone',
  'billingAddress',
  'shippingAddress',
  'currency',
  'paymentTermsDays',
  'creditLimit',
  'notes',
] as const;

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

  private view(
    c: Row,
    balances: { receivable: number; payable: number } = {
      receivable: 0,
      payable: 0,
    },
  ) {
    const { shareToken, shareViews, shareViewedAt, ...rest } = c;
    return {
      ...rest,
      billingAddress: c.billingAddress as ContactAddress,
      shippingAddress: c.shippingAddress as ContactAddress | null,
      archived: !!c.archivedAt,
      creditLimit: c.creditLimit === null ? null : Number(c.creditLimit),
      /** The customer's account link, and how often it was opened */
      share: shareToken
        ? { token: shareToken, views: shareViews, lastViewedAt: shareViewedAt }
        : null,
      ...balances,
    };
  }

  /**
   * What each customer owes, in their currency: unpaid issued invoices, less receipts not yet allocated
   * (advances). Negative = they're in credit.
   */
  private async receivables(organizationId: string, ids: string[]) {
    if (!ids.length)
      return new Map<string, { receivable: number; payable: number }>();
    const rows = await this.prisma.$queryRaw<
      { contact_id: string; owed: bigint; owing: bigint }[]
    >`
      SELECT c.id AS contact_id,
             coalesce((SELECT sum(i.total - i.amount_paid) FROM invoices i WHERE i.organization_id = c.organization_id AND i.contact_id = c.id AND i.status = 'issued'), 0)
           - coalesce((SELECT sum(p.amount - p.allocated) FROM payments p WHERE p.organization_id = c.organization_id AND p.contact_id = c.id AND p.kind = 'receipt' AND p.status = 'posted'), 0)
           - coalesce((SELECT sum(n.total - n.applied) FROM credit_notes n WHERE n.organization_id = c.organization_id AND n.contact_id = c.id AND n.status = 'issued'), 0) AS owed,
             coalesce((SELECT sum(b.total - b.amount_paid) FROM bills b WHERE b.organization_id = c.organization_id AND b.contact_id = c.id AND b.status = 'open'), 0)
           - coalesce((SELECT sum(p.amount - p.allocated) FROM payments p WHERE p.organization_id = c.organization_id AND p.contact_id = c.id AND p.kind = 'payment' AND p.status = 'posted'), 0) AS owing
      FROM contacts c
      WHERE c.organization_id = ${organizationId}::uuid AND c.id = ANY(${ids}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.contact_id,
        { receivable: Number(r.owed), payable: Number(r.owing) },
      ]),
    );
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const c = await tx.contact.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!c) throw new NotFoundException('Contact not found.');
    return c;
  }

  /** Customers and vendors as CSV, in the columns the contacts import reads; recorded as an export */
  async exportCsv(
    organizationId: string,
    q: { search?: string; type?: 'customer' | 'vendor'; archived: boolean },
    ctx: Ctx,
  ) {
    const rows = await allPages((page) =>
      this.list(organizationId, { ...q, page, pageSize: 100 }),
    );
    await this.audit.record({
      action: 'org.report.export',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'report',
      entityId: 'contacts',
      after: { report: 'contacts', ...q, rows: rows.length },
      req: ctx.req,
    });
    return toCsv([
      [
        'name',
        'kind',
        'legal name',
        'gstin',
        'email',
        'phone',
        'address',
        'city',
        'state',
        'pin code',
        'country',
        'currency',
        'payment terms',
        'credit limit',
        'notes',
      ],
      ...rows.map((c) => [
        c.name,
        c.isCustomer && c.isVendor
          ? 'both'
          : c.isCustomer
            ? 'customer'
            : 'vendor',
        c.legalName ?? '',
        c.taxId ?? '',
        c.email ?? '',
        c.phone ?? '',
        c.billingAddress.line1 ?? '',
        c.billingAddress.city ?? '',
        c.billingAddress.region ?? '',
        c.billingAddress.postalCode ?? '',
        c.billingAddress.country ?? '',
        c.currency ?? '',
        c.paymentTermsDays,
        c.creditLimit ?? '',
        c.notes ?? '',
      ]),
    ]);
  }

  async list(
    organizationId: string,
    q: {
      search?: string;
      type?: 'customer' | 'vendor';
      archived: boolean;
      page: number;
      pageSize: number;
    },
  ) {
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
      this.prisma.contact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
    ]);
    const owed = await this.receivables(
      organizationId,
      rows.map((r) => r.id),
    );
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => this.view(r, owed.get(r.id))),
    };
  }

  async get(organizationId: string, id: string) {
    const c = await this.find(this.prisma, organizationId, id);
    return this.view(c, (await this.receivables(organizationId, [id])).get(id));
  }

  /** The checks a whole contact must pass: a unique name, an enabled currency, and the GSTIN rules. */
  private async check(
    tx: Tx,
    organizationId: string,
    v: Values,
    exceptId?: string,
  ) {
    if (
      await tx.contact.findFirst({
        where: {
          organizationId,
          name: { equals: v.name, mode: 'insensitive' },
          ...(exceptId && { NOT: { id: exceptId } }),
        },
        select: { id: true },
      })
    ) {
      throw refuse(
        ConflictException,
        'Another contact already has this name.',
        'name_taken',
        { field: 'name' },
      );
    }
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    // The base currency is stored as "no currency"
    const currency = v.currency === org.baseCurrency ? null : v.currency;
    if (
      currency &&
      !(await tx.organizationCurrency.findUnique({
        where: { organizationId_code: { organizationId, code: currency } },
      }))
    ) {
      throw refuse(
        BadRequestException,
        `Enable ${currency} under Currencies first.`,
        'currency_not_enabled',
        { field: 'currency' },
      );
    }
    const whole = contactCreateSchema.safeParse(v);
    if (!whole.success) {
      const issue = whole.error.issues[0]!;
      throw new BadRequestException({
        message: issue.message,
        details: { reason: 'invalid', field: issue.path.join('.') },
      });
    }
    return { ...v, currency, stateCode: contactStateCode(v) };
  }

  private data(v: Values & { stateCode: string | null }) {
    return {
      ...v,
      creditLimit:
        v.creditLimit === null || v.creditLimit === undefined
          ? null
          : BigInt(v.creditLimit),
      billingAddress: v.billingAddress as Prisma.InputJsonValue,
      shippingAddress:
        v.shippingAddress === null
          ? Prisma.DbNull
          : (v.shippingAddress as Prisma.InputJsonValue),
    };
  }

  async create(input: Values, ctx: Ctx) {
    return this.prisma.$transaction((tx) => this.createInTx(tx, input, ctx));
  }

  /** The same, inside the caller's transaction (imports create many in one) */
  async createInTx(tx: Tx, input: Values, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.lock(tx, organizationId);
    const v = await this.check(tx, organizationId, input);
    const c = await tx.contact.create({
      data: { organizationId, ...this.data(v) },
      select,
    });
    await this.audit.record(
      {
        action: 'org.contact.create',
        actorId: ctx.actor.userId,
        organizationId,
        entityType: 'contact',
        entityId: c.id,
        after: {
          name: c.name,
          isCustomer: c.isCustomer,
          isVendor: c.isVendor,
          taxId: c.taxId,
          currency: c.currency,
        },
        req: ctx.req,
      },
      tx,
    );
    return this.view(c);
  }

  async update(id: string, input: ContactUpdateInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = this.view(await this.find(tx, organizationId, id));
      const merged = {
        ...Object.fromEntries(EDITABLE.map((k) => [k, current[k]])),
        ...input,
      } as Values;
      const changed = EDITABLE.filter(
        (k) =>
          k in input &&
          JSON.stringify(merged[k]) !== JSON.stringify(current[k]),
      );
      if (!changed.length) return current;
      const v = await this.check(tx, organizationId, merged, id);
      const data = this.data(v);
      const c = await tx.contact.update({
        where: { id },
        data: {
          ...Object.fromEntries(changed.map((k) => [k, data[k]])),
          stateCode: v.stateCode,
        },
        select,
      });
      await this.audit.record(
        {
          action: 'org.contact.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'contact',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, current[k]])),
          after: Object.fromEntries(changed.map((k) => [k, v[k]])),
          req: ctx.req,
        },
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
      if (archive === !!c.archivedAt)
        throw refuse(
          ConflictException,
          archive
            ? 'This contact is already archived.'
            : 'This contact isn’t archived.',
          archive ? 'already_archived' : 'not_archived',
        );
      const updated = await tx.contact.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
        select,
      });
      await this.audit.record(
        {
          action: archive ? 'org.contact.archive' : 'org.contact.restore',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'contact',
          entityId: id,
          after: { name: c.name },
          req: ctx.req,
        },
        tx,
      );
      return this.view(updated);
    });
  }

  /** Deletes a contact nothing refers to yet; once invoices or bills use it, it can only be archived. */
  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (
        (await tx.invoice.count({
          where: { organizationId, contactId: id },
        })) ||
        (await tx.bill.count({ where: { organizationId, contactId: id } }))
      )
        throw refuse(
          ConflictException,
          'Invoices or bills use this contact. Archive it instead.',
          'in_use',
        );
      await tx.contact.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.contact.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'contact',
          entityId: id,
          before: { name: c.name },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
