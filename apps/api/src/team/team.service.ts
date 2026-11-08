import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BUILT_IN_ROLES,
  canAssignRole,
  customRoleDefinition,
  isBuiltInRole,
  type CustomRoleInput,
  type RoleChoice,
  type RoleDefinition,
} from '@ledgernest/shared';
import type { Request } from 'express';
import { TenantPrisma } from '../access/tenant-prisma.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type MembershipRole = { builtInRole: string | null; customRole: { id: string; name: string; permissions: string[] } | null };

const refuse = (Ex: typeof ForbiddenException | typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

/** Everything an organisation's admins do to their team: members, invitations and custom roles. */
@Injectable()
export class TeamService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
  ) {}

  private get db() {
    return this.tenantPrisma.db;
  }

  // ---------- who may do what ----------

  /** The caller's own role as the access rules see it. */
  private actorDefinition({ actor, tenant }: Ctx): RoleDefinition {
    if (actor.isSuperAdmin || tenant.role.type === 'support') return BUILT_IN_ROLES.super_admin;
    if (tenant.role.type === 'built_in') return BUILT_IN_ROLES[tenant.role.key];
    return customRoleDefinition(tenant.role.id, [...tenant.permissions]);
  }

  private definitionOf(m: MembershipRole): RoleDefinition {
    if (m.builtInRole && isBuiltInRole(m.builtInRole)) return BUILT_IN_ROLES[m.builtInRole];
    return customRoleDefinition(m.customRole?.id ?? 'unknown', m.customRole?.permissions ?? []);
  }

  /** Resolves a role choice to its definition; custom roles must belong to this organisation. */
  private async resolveChoice(choice: RoleChoice) {
    if ('builtInRole' in choice) return { definition: BUILT_IN_ROLES[choice.builtInRole], data: { builtInRole: choice.builtInRole, customRoleId: null } };
    const role = await this.db.role.findUnique({ where: { id: choice.customRoleId }, select: { id: true, permissions: true } });
    if (!role) throw new NotFoundException('Role not found.');
    return { definition: customRoleDefinition(role.id, role.permissions), data: { builtInRole: null, customRoleId: role.id } };
  }

  /** The golden rule: nobody grants more access than they have. */
  private assertCanAssign(ctx: Ctx, target: RoleDefinition) {
    const mine = this.actorDefinition(ctx);
    if (!canAssignRole(mine, target)) {
      const missing = target.permissions.filter((p) => !mine.permissions.includes(p));
      throw refuse(ForbiddenException, "You can't give a role with more access than your own.", 'exceeds_your_access', missing.length ? { missing } : {});
    }
  }

  /** Every organisation keeps at least one Owner. Runs under a per-organisation lock. */
  private async assertNotLastOwner(tx: { $executeRaw: PrismaService['$executeRaw']; membership: { count: (a: object) => Promise<number> } }, organizationId: string, membershipId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    const others = await tx.membership.count({ where: { builtInRole: 'owner', id: { not: membershipId } } });
    if (others === 0) throw refuse(ConflictException, 'Every organisation needs at least one Owner. Make someone else an Owner first.', 'last_owner');
  }

  // ---------- members ----------

  async listMembers() {
    const rows = await this.db.membership.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        builtInRole: true,
        createdAt: true,
        customRole: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      user: m.user,
      role: m.builtInRole ? { type: 'built_in' as const, key: m.builtInRole } : { type: 'custom' as const, id: m.customRole?.id, name: m.customRole?.name },
      joinedAt: m.createdAt,
    }));
  }

  private async findMember(id: string) {
    const m = await this.db.membership.findUnique({
      where: { id },
      select: { id: true, userId: true, builtInRole: true, customRole: { select: { id: true, name: true, permissions: true } }, user: { select: { email: true } } },
    });
    if (!m) throw new NotFoundException('Member not found.');
    return m;
  }

  async changeMemberRole(id: string, choice: RoleChoice, ctx: Ctx) {
    const member = await this.findMember(id);
    if (member.userId === ctx.actor.userId) throw refuse(BadRequestException, "You can't change your own role. Ask another Owner or Admin.", 'self');
    this.assertCanAssign(ctx, this.definitionOf(member)); // may I manage this person at all?
    const next = await this.resolveChoice(choice);
    this.assertCanAssign(ctx, next.definition); // and give them this role?

    return this.db.$transaction(async (tx) => {
      if (member.builtInRole === 'owner' && next.data.builtInRole !== 'owner') await this.assertNotLastOwner(tx, ctx.tenant.organizationId, id);
      await tx.membership.update({ where: { id }, data: next.data });
      await this.audit.record(
        {
          action: 'org.member.role_change',
          actorId: ctx.actor.userId,
          organizationId: ctx.tenant.organizationId,
          entityType: 'membership',
          entityId: id,
          before: { user: member.user.email, builtInRole: member.builtInRole, customRoleId: member.customRole?.id ?? null },
          after: { user: member.user.email, ...next.data },
          req: ctx.req,
        },
        tx,
      );
      return { id, role: next.data.builtInRole ? { type: 'built_in', key: next.data.builtInRole } : { type: 'custom', id: next.data.customRoleId } };
    });
  }

  async removeMember(id: string, ctx: Ctx) {
    const member = await this.findMember(id);
    if (member.userId === ctx.actor.userId) throw refuse(BadRequestException, "You can't remove yourself. Ask another Owner or Admin.", 'self');
    this.assertCanAssign(ctx, this.definitionOf(member));
    await this.db.$transaction(async (tx) => {
      if (member.builtInRole === 'owner') await this.assertNotLastOwner(tx, ctx.tenant.organizationId, id);
      await tx.membership.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.member.remove',
          actorId: ctx.actor.userId,
          organizationId: ctx.tenant.organizationId,
          entityType: 'membership',
          entityId: id,
          before: { user: member.user.email, builtInRole: member.builtInRole, customRoleId: member.customRole?.id ?? null },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  // ---------- invitations ----------

  async listInvitations() {
    const rows = await this.db.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, builtInRole: true, expiresAt: true, createdAt: true, customRole: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } },
    });
    const now = Date.now();
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.builtInRole ? { type: 'built_in' as const, key: i.builtInRole } : { type: 'custom' as const, id: i.customRole?.id, name: i.customRole?.name },
      invitedBy: i.invitedBy.name,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      expired: i.expiresAt.getTime() <= now,
    }));
  }

  async invite(email: string, choice: RoleChoice, ctx: Ctx) {
    const next = await this.resolveChoice(choice);
    this.assertCanAssign(ctx, next.definition);

    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser && (await this.db.membership.count({ where: { userId: existingUser.id } }))) {
      throw refuse(ConflictException, 'This person is already a member.', 'already_member');
    }
    if (await this.db.invitation.count({ where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } })) {
      throw refuse(ConflictException, 'This person already has a pending invitation. Resend it instead.', 'already_invited');
    }

    return this.db.$transaction(async (tx) => {
      const role = next.data.builtInRole ? { builtInRole: next.data.builtInRole as Exclude<typeof next.data.builtInRole, null> } : { customRoleId: next.data.customRoleId! };
      const inv = await this.invitations.create(tx, { organizationId: ctx.tenant.organizationId, email, role: role as Parameters<InvitationsService['create']>[1]['role'], invitedById: ctx.actor.userId });
      await this.audit.record(
        { action: 'org.invitation.create', actorId: ctx.actor.userId, organizationId: ctx.tenant.organizationId, entityType: 'invitation', entityId: inv.id, after: { email, ...next.data }, req: ctx.req },
        tx,
      );
      return { id: inv.id, email, inviteUrl: inv.url, expiresAt: inv.expiresAt, accountExists: !!existingUser };
    });
  }

  private async findPendingInvitation(id: string) {
    const inv = await this.db.invitation.findUnique({ where: { id }, select: { id: true, email: true, builtInRole: true, customRoleId: true, acceptedAt: true, revokedAt: true, customRole: { select: { id: true, permissions: true } } } });
    if (!inv || inv.revokedAt) throw new NotFoundException('Invitation not found.');
    if (inv.acceptedAt) throw refuse(ConflictException, 'This invitation has already been accepted.', 'already_accepted');
    return inv;
  }

  /** A fresh link with a new 7-day window. The old link stops working. */
  async resendInvitation(id: string, ctx: Ctx) {
    const old = await this.findPendingInvitation(id);
    this.assertCanAssign(ctx, this.definitionOf({ builtInRole: old.builtInRole, customRole: old.customRole ? { ...old.customRole, name: '' } : null }));
    return this.db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      const role = old.builtInRole ? { builtInRole: old.builtInRole } : { customRoleId: old.customRoleId! };
      const inv = await this.invitations.create(tx, { organizationId: ctx.tenant.organizationId, email: old.email, role: role as Parameters<InvitationsService['create']>[1]['role'], invitedById: ctx.actor.userId });
      await this.audit.record(
        { action: 'org.invitation.resend', actorId: ctx.actor.userId, organizationId: ctx.tenant.organizationId, entityType: 'invitation', entityId: inv.id, before: { invitationId: id }, after: { email: old.email }, req: ctx.req },
        tx,
      );
      return { id: inv.id, email: old.email, inviteUrl: inv.url, expiresAt: inv.expiresAt };
    });
  }

  async revokeInvitation(id: string, ctx: Ctx) {
    const inv = await this.findPendingInvitation(id);
    this.assertCanAssign(ctx, this.definitionOf({ builtInRole: inv.builtInRole, customRole: inv.customRole ? { ...inv.customRole, name: '' } : null }));
    await this.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'org.invitation.revoke', actorId: ctx.actor.userId, organizationId: ctx.tenant.organizationId, entityType: 'invitation', entityId: id, before: { email: inv.email }, req: ctx.req });
  }

  // ---------- roles ----------

  /** Built-in roles (read-only) and this organisation's custom roles, with how many people hold each. */
  async listRoles(ctx: Ctx) {
    const [custom, counts] = await Promise.all([
      this.db.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, description: true, permissions: true, createdAt: true, _count: { select: { memberships: true } } } }),
      this.db.membership.groupBy({ by: ['builtInRole'], _count: { _all: true } }),
    ]);
    const mine = this.actorDefinition(ctx);
    const builtIn = (['owner', 'admin', 'accountant', 'bookkeeper', 'auditor', 'viewer'] as const).map((key) => ({
      type: 'built_in' as const,
      key,
      permissions: [...BUILT_IN_ROLES[key].permissions],
      memberCount: counts.find((c) => c.builtInRole === key)?._count._all ?? 0,
      canAssign: canAssignRole(mine, BUILT_IN_ROLES[key]),
    }));
    return {
      builtIn,
      custom: custom.map(({ _count, ...r }) => ({ type: 'custom' as const, ...r, memberCount: _count.memberships, canAssign: canAssignRole(mine, customRoleDefinition(r.id, r.permissions)) })),
    };
  }

  /** You can only build a role from permissions you hold yourself. */
  private assertWithinMyAccess(ctx: Ctx, permissions: readonly string[]) {
    const mine = this.actorDefinition(ctx);
    const missing = permissions.filter((p) => !mine.permissions.includes(p as never));
    if (missing.length) throw refuse(ForbiddenException, "A role can't include access you don't have.", 'exceeds_your_access', { missing });
  }

  private nameTaken(e: unknown): never {
    if ((e as { code?: string }).code === 'P2002') throw refuse(ConflictException, 'A role with this name already exists.', 'name_taken');
    throw e;
  }

  async createRole(input: Required<Pick<CustomRoleInput, 'name' | 'permissions'>> & { description?: string | null }, ctx: Ctx) {
    this.assertWithinMyAccess(ctx, input.permissions);
    const role = await this.db.role
      .create({ data: { name: input.name, description: input.description ?? null, permissions: input.permissions, organizationId: ctx.tenant.organizationId }, select: { id: true, name: true, description: true, permissions: true } })
      .catch((e: unknown) => this.nameTaken(e));
    await this.audit.record({ action: 'org.role.create', actorId: ctx.actor.userId, organizationId: ctx.tenant.organizationId, entityType: 'role', entityId: role.id, after: role, req: ctx.req });
    return role;
  }

  private async findRole(id: string) {
    const role = await this.db.role.findUnique({ where: { id }, select: { id: true, name: true, description: true, permissions: true, _count: { select: { memberships: true } } } });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  async updateRole(id: string, input: Partial<CustomRoleInput>, ctx: Ctx) {
    const role = await this.findRole(id);
    this.assertCanAssign(ctx, customRoleDefinition(role.id, role.permissions)); // may I touch this role?
    if (input.permissions) this.assertWithinMyAccess(ctx, input.permissions);
    const updated = await this.db.role
      .update({ where: { id }, data: { name: input.name, description: input.description, permissions: input.permissions }, select: { id: true, name: true, description: true, permissions: true } })
      .catch((e: unknown) => this.nameTaken(e));
    await this.audit.record({
      action: 'org.role.update',
      actorId: ctx.actor.userId,
      organizationId: ctx.tenant.organizationId,
      entityType: 'role',
      entityId: id,
      before: { name: role.name, description: role.description, permissions: role.permissions },
      after: updated,
      req: ctx.req,
    });
    return updated;
  }

  async deleteRole(id: string, ctx: Ctx) {
    const role = await this.findRole(id);
    this.assertCanAssign(ctx, customRoleDefinition(role.id, role.permissions));
    if (role._count.memberships > 0) {
      throw refuse(ConflictException, 'People still have this role. Give them another role first.', 'in_use', { memberCount: role._count.memberships });
    }
    await this.db.role.delete({ where: { id } }); // pending invitations for it are withdrawn by the database
    await this.audit.record({ action: 'org.role.delete', actorId: ctx.actor.userId, organizationId: ctx.tenant.organizationId, entityType: 'role', entityId: id, before: { name: role.name, permissions: role.permissions }, req: ctx.req });
  }
}
