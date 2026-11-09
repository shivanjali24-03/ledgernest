import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_TIME_ZONES, slugify, type OrganizationCreateInput, type OrganizationUpdateInput } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';

type Page = { search?: string; page: number; pageSize: number };
const DAY = 86_400_000;

/** Serialises changes to who is a Super Admin, so two admins can't demote each other at the same moment. */
const SUPER_ADMIN_LOCK = 7_310_001;

const orgSelect = { id: true, name: true, slug: true, status: true, baseCurrency: true, locale: true, timeZone: true, country: true, fiscalYearStartMonth: true, createdAt: true } as const;
const userSelect = { id: true, name: true, email: true, status: true, isSuperAdmin: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
  ) {}

  // ---------- organisations ----------

  async listOrganizations(q: Page & { status?: 'ACTIVE' | 'SUSPENDED' }) {
    const where: Prisma.OrganizationWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.search && { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search, mode: 'insensitive' } }] }),
    };
    const [total, items] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { ...orgSelect, _count: { select: { memberships: true } } },
      }),
    ]);
    return { items: items.map(({ _count, ...o }) => ({ ...o, memberCount: _count.memberships })), page: q.page, pageSize: q.pageSize, total };
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        ...orgSelect,
        _count: { select: { memberships: true } },
        memberships: { where: { builtInRole: 'owner' }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } },
        invitations: {
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, email: true, builtInRole: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!org) throw new NotFoundException('Organisation not found.');
    const { _count, memberships, invitations, ...rest } = org;
    return { ...rest, memberCount: _count.memberships, owners: memberships.map((m) => m.user), pendingInvitations: invitations };
  }

  /** Creates an organisation and its first Owner: added at once if they have an account, otherwise invited. */
  async createOrganization(input: Required<Omit<OrganizationCreateInput, 'slug'>> & { slug?: string }, actor: Actor, req: Request) {
    const slug = input.slug ?? (await this.freeSlug(slugify(input.name) || 'organisation'));
    if (input.slug && (await this.prisma.organization.findUnique({ where: { slug }, select: { id: true } }))) {
      throw new ConflictException({ message: 'That web address is taken. Try another.', details: { field: 'slug' } });
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: input.name,
          slug,
          baseCurrency: input.baseCurrency,
          locale: input.locale,
          country: input.country,
          // The country's time zone; the organisation can change it in its settings
          timeZone: (input.country && DEFAULT_TIME_ZONES[input.country]) || 'Asia/Kolkata',
          fiscalYearStartMonth: input.fiscalYearStartMonth,
        },
        select: orgSelect,
      });
      // Every organisation starts with the accounts LedgerNest relies on, named in its language
      await AccountsService.createSystemAccounts(tx, org.id, org.locale);

      const existing = await tx.user.findUnique({ where: { email: input.owner.email }, select: { id: true } });
      let owner: { status: 'added'; userId: string } | { status: 'invited'; email: string; inviteUrl: string; expiresAt: Date };
      if (existing) {
        await tx.membership.create({ data: { userId: existing.id, organizationId: org.id, builtInRole: 'owner' } });
        owner = { status: 'added', userId: existing.id };
      } else {
        const inv = await this.invitations.create(tx, { organizationId: org.id, email: input.owner.email, role: { builtInRole: 'owner' }, invitedById: actor.userId });
        owner = { status: 'invited', email: input.owner.email, inviteUrl: inv.url, expiresAt: inv.expiresAt };
      }

      await this.audit.record(
        { action: 'platform.organization.create', actorId: actor.userId, organizationId: org.id, entityType: 'organization', entityId: org.id, after: { ...org, owner: { email: input.owner.email, status: owner.status } }, req },
        tx,
      );
      return { organization: org, owner };
    });
  }

  async updateOrganization(id: string, input: OrganizationUpdateInput, actor: Actor, req: Request) {
    const before = await this.prisma.organization.findUnique({ where: { id }, select: orgSelect });
    if (!before) throw new NotFoundException('Organisation not found.');
    const after = await this.prisma.organization.update({ where: { id }, data: input, select: orgSelect });
    const changed = Object.keys(input) as (keyof typeof before)[];
    await this.audit.record({
      action: 'platform.organization.update',
      actorId: actor.userId,
      organizationId: id,
      entityType: 'organization',
      entityId: id,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      req,
    });
    return after;
  }

  async setOrganizationStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string | undefined, actor: Actor, req: Request) {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { status: true } });
    if (!org) throw new NotFoundException('Organisation not found.');
    if (org.status === status) throw new ConflictException(status === 'SUSPENDED' ? 'This organisation is already suspended.' : 'This organisation is already active.');
    const updated = await this.prisma.organization.update({ where: { id }, data: { status }, select: orgSelect });
    await this.audit.record({
      action: status === 'SUSPENDED' ? 'platform.organization.suspend' : 'platform.organization.reactivate',
      actorId: actor.userId,
      organizationId: id,
      entityType: 'organization',
      entityId: id,
      before: { status: org.status },
      after: { status, reason: reason ?? null },
      req,
    });
    return updated;
  }

  // ---------- platform users ----------

  async listUsers(q: Page & { superAdmin?: boolean; status?: 'ACTIVE' | 'SUSPENDED' }) {
    const where: Prisma.UserWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.superAdmin !== undefined && { isSuperAdmin: q.superAdmin }),
      ...(q.search && { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }),
    };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ isSuperAdmin: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { ...userSelect, _count: { select: { memberships: true } } },
      }),
    ]);
    return { items: items.map(({ _count, ...u }) => ({ ...u, organizationCount: _count.memberships })), page: q.page, pageSize: q.pageSize, total };
  }

  setSuperAdmin(userId: string, makeSuperAdmin: boolean, actor: Actor, req: Request) {
    return this.changeUser(userId, actor, req, async (tx, user) => {
      if (user.isSuperAdmin === makeSuperAdmin) throw new ConflictException(makeSuperAdmin ? 'This person is already a Super Admin.' : 'This person is not a Super Admin.');
      if (makeSuperAdmin && user.status !== 'ACTIVE') {
        throw new BadRequestException({ message: 'Reactivate this account before making it a Super Admin.', details: { reason: 'inactive' } });
      }
      if (!makeSuperAdmin) await this.assertNotLastSuperAdmin(tx, user);
      return { data: { isSuperAdmin: makeSuperAdmin }, action: makeSuperAdmin ? 'platform.user.promote' : 'platform.user.demote' };
    });
  }

  setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string | undefined, actor: Actor, req: Request) {
    return this.changeUser(userId, actor, req, async (tx, user) => {
      if (user.status === status) throw new ConflictException(status === 'SUSPENDED' ? 'This account is already suspended.' : 'This account is already active.');
      if (status === 'SUSPENDED') {
        if (user.id === actor.userId) throw new BadRequestException({ message: "You can't suspend your own account.", details: { reason: 'self' } });
        await this.assertNotLastSuperAdmin(tx, user);
        // End every session at once
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return { data: { status }, action: status === 'SUSPENDED' ? 'platform.user.suspend' : 'platform.user.reactivate', reason };
    });
  }

  // ---------- stats ----------

  async stats() {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since7 = new Date(Date.now() - 7 * DAY);
    const [orgs, newOrgs, users, superAdmins, signIns, failedSignIns, recent] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.organization.count({ where: { createdAt: { gte: since30 } } }),
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count({ where: { isSuperAdmin: true, status: 'ACTIVE' } }),
      this.prisma.auditLog.count({ where: { action: 'auth.login.success', createdAt: { gte: since7 } } }),
      this.prisma.auditLog.count({ where: { action: { in: ['auth.login.failed', 'auth.lockout'] }, createdAt: { gte: since7 } } }),
      this.prisma.auditLog.findMany({
        where: { action: { startsWith: 'platform.' }, NOT: { action: 'platform.support_access' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, action: true, createdAt: true, entityType: true, entityId: true, actor: { select: { name: true, email: true } }, organization: { select: { id: true, name: true } } },
      }),
    ]);
    const byStatus = (rows: { status: string; _count: { _all: number } }[]) => {
      const active = rows.find((r) => r.status === 'ACTIVE')?._count._all ?? 0;
      const suspended = rows.find((r) => r.status === 'SUSPENDED')?._count._all ?? 0;
      return { total: active + suspended, active, suspended };
    };
    return {
      organizations: { ...byStatus(orgs), newLast30Days: newOrgs },
      users: { ...byStatus(users), superAdmins },
      activity: { signInsLast7Days: signIns, failedSignInsLast7Days: failedSignIns },
      recent,
    };
  }

  // ---------- helpers ----------

  private async freeSlug(base: string) {
    const taken = new Set((await this.prisma.organization.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((o) => o.slug));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base.slice(0, 44)}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async changeUser(
    userId: string,
    actor: Actor,
    req: Request,
    decide: (tx: Prisma.TransactionClient, user: { id: string; isSuperAdmin: boolean; status: string }) => Promise<{ data: Prisma.UserUpdateInput; action: string; reason?: string }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isSuperAdmin: true, status: true } });
      if (!user) throw new NotFoundException('User not found.');
      const { data, action, reason } = await decide(tx, user);
      const updated = await tx.user.update({ where: { id: userId }, data, select: userSelect });
      await this.audit.record(
        {
          action,
          actorId: actor.userId,
          entityType: 'user',
          entityId: userId,
          before: { isSuperAdmin: user.isSuperAdmin, status: user.status },
          after: { isSuperAdmin: updated.isSuperAdmin, status: updated.status, ...(reason && { reason }) },
          req,
        },
        tx,
      );
      return updated;
    });
  }

  /** LedgerNest must always keep at least one active Super Admin. */
  private async assertNotLastSuperAdmin(tx: Prisma.TransactionClient, user: { id: string; isSuperAdmin: boolean; status: string }) {
    if (!user.isSuperAdmin || user.status !== 'ACTIVE') return;
    const others = await tx.user.count({ where: { isSuperAdmin: true, status: 'ACTIVE', id: { not: user.id } } });
    if (others === 0) {
      throw new ConflictException({ message: 'LedgerNest needs at least one active Super Admin. Make someone else a Super Admin first.', details: { reason: 'last_super_admin' } });
    }
  }
}
