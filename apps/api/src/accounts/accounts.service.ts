import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  namedTemplate,
  type Industry,
  compareCodes,
  MAX_ACCOUNT_DEPTH,
  NORMAL_SIDE,
  SYSTEM_ACCOUNTS,
  subtypeBelongsTo,
  systemAccountName,
  type AccountType,
  type SystemAccountKey,
  type AccountCreateInput,
  type AccountUpdateInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { TenantPrisma } from '../access/tenant-prisma.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const select = { id: true, code: true, name: true, type: true, subtype: true, description: true, parentId: true, systemKey: true, archivedAt: true } as const;
type Row = Prisma.AccountGetPayload<{ select: typeof select }>;
type Tx = Prisma.TransactionClient;

/** What the audit log records about an account. */
const snapshot = (a: Partial<Row>) => ({ code: a.code, name: a.name, type: a.type, subtype: a.subtype, parentId: a.parentId, description: a.description });

/**
 * The chart of accounts. Writes are serialised per organisation with an advisory lock,
 * so code and name checks, tree depth and cycle checks can't race each other.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /** Creates the system accounts an organisation lacks, named in its language. Used when organisations are created. */
  static async createSystemAccounts(tx: Tx, organizationId: string, locale: string) {
    for (const [key, def] of Object.entries(SYSTEM_ACCOUNTS) as [SystemAccountKey, (typeof SYSTEM_ACCOUNTS)[SystemAccountKey]][]) {
      await tx.account.upsert({
        where: { organizationId_systemKey: { organizationId, systemKey: key } },
        create: { organizationId, systemKey: key, code: def.code, type: def.type, subtype: def.subtype, name: systemAccountName(key, locale) },
        update: {},
      });
    }
  }

  /**
   * Creates an industry's chart of accounts, named in the organisation's language.
   * Only for a chart that holds nothing but the system accounts, so a template never overwrites real work.
   */
  static async applyTemplate(tx: Tx, organizationId: string, locale: string, industry: Industry) {
    if (await tx.account.count({ where: { organizationId, systemKey: null } })) {
      throw refuse(ConflictException, 'Templates can only be applied to an empty chart of accounts.', 'chart_not_empty');
    }
    const ids = new Map<string, string>();
    const template = namedTemplate(industry, locale);
    for (const a of template) {
      const created = await tx.account.create({
        data: { organizationId, code: a.code, name: a.name, type: a.type, subtype: a.subtype, parentId: a.parent ? ids.get(a.parent)! : null },
        select: { id: true },
      });
      ids.set(a.code, created.id);
    }
    return template.length;
  }

  /** A template as it would be created for this organisation (names in its language). */
  async previewTemplate(organizationId: string, industry: Industry) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { locale: true } });
    return namedTemplate(industry, org.locale);
  }

  async applyTemplateFor(industry: Industry, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const count = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { locale: true } });
      const n = await AccountsService.applyTemplate(tx, organizationId, org.locale, industry);
      await this.audit.record({ action: 'org.account.template_apply', actorId: ctx.actor.userId, organizationId, entityType: 'organization', entityId: organizationId, after: { industry, accounts: n }, req: ctx.req }, tx);
      return n;
    });
    return { industry, created: count };
  }

  /** Whether any of these accounts is used by a journal line (drafts included). */
  private hasEntries(tx: Tx, organizationId: string, accountIds: string[]): Promise<boolean> {
    return JournalsService.accountsHaveLines(tx, organizationId, accountIds);
  }

  private async usedByTax(tx: Tx, organizationId: string, id: string) {
    return (await tx.taxRate.count({ where: { organizationId, OR: [{ outputAccountId: id }, { inputAccountId: id }] } })) > 0;
  }

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'accounts:' + organizationId}))`;
  }

  private view(a: Row, childCount: number) {
    return {
      ...a,
      type: a.type as AccountType,
      normalSide: NORMAL_SIDE[a.type as AccountType],
      system: a.systemKey !== null,
      archived: a.archivedAt !== null,
      childCount,
    };
  }

  /** Every account, ordered by code. Archived ones only when asked for. */
  async list(includeArchived: boolean) {
    const rows = await this.tenantPrisma.db.account.findMany({ where: includeArchived ? {} : { archivedAt: null }, select });
    const children = new Map<string, number>();
    for (const r of rows) if (r.parentId) children.set(r.parentId, (children.get(r.parentId) ?? 0) + 1);
    return rows.sort((a, b) => compareCodes(a.code, b.code)).map((r) => this.view(r, children.get(r.id) ?? 0));
  }

  private async find(tx: Tx, organizationId: string, id: string) {
    const a = await tx.account.findFirst({ where: { id, organizationId }, select });
    if (!a) throw new NotFoundException('Account not found.');
    return a;
  }

  /** Levels from the top down to this account (a top-level account is 1). */
  private async depthOf(tx: Tx, organizationId: string, id: string) {
    let depth = 0;
    for (let at: string | null = id; at && depth <= MAX_ACCOUNT_DEPTH + 1; depth++) {
      const row: { parentId: string | null } | null = await tx.account.findFirst({ where: { id: at, organizationId }, select: { parentId: true } });
      at = row?.parentId ?? null;
    }
    return depth;
  }

  /** How many levels sit below this account, including itself (a leaf is 1), and every id in its subtree. */
  private async subtree(tx: Tx, organizationId: string, id: string) {
    const all = await tx.account.findMany({ where: { organizationId }, select: { id: true, parentId: true } });
    const kids = new Map<string, string[]>();
    for (const a of all) if (a.parentId) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a.id]);
    const ids = new Set<string>();
    const height = (at: string): number => {
      ids.add(at);
      return 1 + Math.max(0, ...(kids.get(at) ?? []).map(height));
    };
    return { height: height(id), ids };
  }

  private async assertUnique(tx: Tx, organizationId: string, values: { code?: string; name?: string }, exceptId?: string) {
    const not = exceptId ? { NOT: { id: exceptId } } : {};
    if (values.code && (await tx.account.findFirst({ where: { organizationId, code: values.code, ...not }, select: { id: true } }))) {
      throw refuse(ConflictException, 'Another account already uses this code.', 'code_taken');
    }
    if (values.name && (await tx.account.findFirst({ where: { organizationId, name: { equals: values.name, mode: 'insensitive' }, ...not }, select: { id: true } }))) {
      throw refuse(ConflictException, 'Another account already has this name.', 'name_taken');
    }
  }

  /** A parent must exist, be active, share the type, and leave room for the subtree being placed under it. */
  private async checkParent(tx: Tx, organizationId: string, parentId: string, type: string, subtreeHeight: number) {
    const parent = await tx.account.findFirst({ where: { id: parentId, organizationId }, select });
    if (!parent) throw refuse(BadRequestException, 'The parent account doesn’t exist.', 'parent_not_found');
    if (parent.archivedAt) throw refuse(ConflictException, 'The parent account is archived.', 'parent_archived');
    if (parent.type !== type) throw refuse(BadRequestException, 'A sub-account must have the same type as its parent.', 'parent_type');
    if ((await this.depthOf(tx, organizationId, parentId)) + subtreeHeight > MAX_ACCOUNT_DEPTH) {
      throw refuse(BadRequestException, `Sub-accounts can be at most ${MAX_ACCOUNT_DEPTH} levels deep.`, 'too_deep', { max: MAX_ACCOUNT_DEPTH });
    }
  }

  async create(input: AccountCreateInput & { parentId: string | null; description: string | null }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      await this.assertUnique(tx, organizationId, input);
      if (input.parentId) await this.checkParent(tx, organizationId, input.parentId, input.type, 1);
      const a = await tx.account.create({
        data: { organizationId, code: input.code, name: input.name, type: input.type, subtype: input.subtype, parentId: input.parentId, description: input.description },
        select,
      });
      await this.audit.record({ action: 'org.account.create', actorId: ctx.actor.userId, organizationId, entityType: 'account', entityId: a.id, after: snapshot(a), req: ctx.req }, tx);
      return a;
    });
    return this.view(created, 0);
  }

  async update(id: string, input: AccountUpdateInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = await this.find(tx, organizationId, id);
      const wanted = { ...input } as Partial<Row>;
      const changed = (Object.keys(wanted) as (keyof Row)[]).filter((k) => wanted[k] !== current[k]);
      const childCount = await tx.account.count({ where: { organizationId, parentId: id } });
      if (!changed.length) return this.view(current, childCount);

      if (current.systemKey && changed.some((k) => k === 'type' || k === 'subtype' || k === 'parentId')) {
        throw refuse(BadRequestException, 'This is a system account: only its code, name and description can change.', 'system');
      }
      const type = (wanted.type ?? current.type) as AccountType;
      const subtype = wanted.subtype ?? current.subtype;
      if (changed.includes('type')) {
        if (childCount) throw refuse(ConflictException, 'An account with sub-accounts can’t change type.', 'has_children');
        if (await this.hasEntries(tx, organizationId, [id])) throw refuse(ConflictException, 'An account with entries can’t change type.', 'has_entries');
        if (await this.usedByTax(tx, organizationId, id)) throw refuse(ConflictException, 'A tax rate posts to this account, so its type can’t change.', 'used_by_tax');
      }
      if (!subtypeBelongsTo(type, subtype)) throw refuse(BadRequestException, 'Choose a sub-type that belongs to this type.', 'subtype');

      await this.assertUnique(tx, organizationId, { code: changed.includes('code') ? wanted.code : undefined, name: changed.includes('name') ? wanted.name : undefined }, id);

      const parentId = changed.includes('parentId') ? (wanted.parentId ?? null) : current.parentId;
      if (parentId && (changed.includes('parentId') || changed.includes('type'))) {
        const sub = await this.subtree(tx, organizationId, id);
        if (sub.ids.has(parentId)) throw refuse(BadRequestException, 'An account can’t sit under itself or its own sub-accounts.', 'cycle');
        await this.checkParent(tx, organizationId, parentId, type, sub.height);
      }

      const data = Object.fromEntries(changed.map((k) => [k, wanted[k]]));
      const updated = await tx.account.update({ where: { id }, data, select });
      await this.audit.record(
        {
          action: 'org.account.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'account',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, current[k]])),
          after: { ...data, code: updated.code, name: updated.name },
          req: ctx.req,
        },
        tx,
      );
      return this.view(updated, childCount);
    });
  }

  /** Hides an account from new entries while keeping its history. Sub-accounts must be archived first. */
  async archive(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const a = await this.find(tx, organizationId, id);
      if (a.systemKey) throw refuse(BadRequestException, 'System accounts can’t be archived.', 'system');
      if (a.archivedAt) throw refuse(ConflictException, 'This account is already archived.', 'already_archived');
      if (await tx.account.count({ where: { organizationId, parentId: id, archivedAt: null } })) {
        throw refuse(ConflictException, 'Archive its sub-accounts first.', 'has_active_children');
      }
      const updated = await tx.account.update({ where: { id }, data: { archivedAt: new Date() }, select });
      await this.audit.record({ action: 'org.account.archive', actorId: ctx.actor.userId, organizationId, entityType: 'account', entityId: id, before: snapshot(a), req: ctx.req }, tx);
      return this.view(updated, await tx.account.count({ where: { organizationId, parentId: id } }));
    });
  }

  async restore(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const a = await this.find(tx, organizationId, id);
      if (!a.archivedAt) throw refuse(ConflictException, 'This account isn’t archived.', 'not_archived');
      if (a.parentId && (await tx.account.findFirst({ where: { id: a.parentId, organizationId, archivedAt: { not: null } }, select: { id: true } }))) {
        throw refuse(ConflictException, 'Restore its parent account first.', 'parent_archived');
      }
      const updated = await tx.account.update({ where: { id }, data: { archivedAt: null }, select });
      await this.audit.record({ action: 'org.account.restore', actorId: ctx.actor.userId, organizationId, entityType: 'account', entityId: id, after: snapshot(a), req: ctx.req }, tx);
      return this.view(updated, await tx.account.count({ where: { organizationId, parentId: id } }));
    });
  }

  /** Removes an unused account. Accounts with sub-accounts or entries can only be archived. */
  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const a = await this.find(tx, organizationId, id);
      if (a.systemKey) throw refuse(BadRequestException, 'System accounts can’t be deleted.', 'system');
      if (await tx.account.count({ where: { organizationId, parentId: id } })) throw refuse(ConflictException, 'Delete or move its sub-accounts first.', 'has_children');
      if (await this.hasEntries(tx, organizationId, [id])) throw refuse(ConflictException, 'This account has entries. Archive it instead.', 'has_entries');
      if (await this.usedByTax(tx, organizationId, id)) throw refuse(ConflictException, 'A tax rate posts to this account. Change the tax rate first.', 'used_by_tax');
      await tx.account.delete({ where: { id } });
      await this.audit.record({ action: 'org.account.delete', actorId: ctx.actor.userId, organizationId, entityType: 'account', entityId: id, before: snapshot(a), req: ctx.req }, tx);
    });
  }
}
