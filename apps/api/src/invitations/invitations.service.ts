import { randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { INVITATION_DAYS, isBuiltInRole, type BuiltInRoleId } from '@ledgernest/shared';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { hashToken } from '../auth/tokens.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient | PrismaService;
export type InviteRole = { builtInRole: Exclude<BuiltInRoleId, 'super_admin'> } | { customRoleId: string };

const INVALID = 'This invitation link is not valid.';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Creates an invitation and returns the link. The raw token is shown once and only its hash is stored. */
  async create(db: Db, input: { organizationId: string; email: string; role: InviteRole; invitedById: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
    const invitation = await db.invitation.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        builtInRole: 'builtInRole' in input.role ? input.role.builtInRole : null,
        customRoleId: 'customRoleId' in input.role ? input.role.customRoleId : null,
        tokenHash: hashToken(token),
        expiresAt,
        invitedById: input.invitedById,
      },
    });
    return { id: invitation.id, url: `${this.config.get('WEB_APP_URL', { infer: true })}/accept-invite?token=${token}`, expiresAt };
  }

  /** What the accept page shows. Anyone holding the link may see it. */
  async preview(token: string) {
    const inv = await this.findUsable(token);
    const account = await this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    return {
      organizationName: inv.organization.name,
      email: inv.email,
      role: inv.builtInRole ? { type: 'built_in', key: inv.builtInRole } : { type: 'custom', name: inv.customRole?.name },
      accountExists: !!account,
      expiresAt: inv.expiresAt,
    };
  }

  /** A new person accepts: their account is created, they join, and they're signed in. */
  async acceptAsNewUser(input: { token: string; name: string; password: string }, req: Request) {
    const inv = await this.findUsable(input.token);
    if (await this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } })) {
      throw new ConflictException('An account with this email already exists. Sign in, then open the invitation link again.');
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.prisma
      .$transaction(async (tx) => {
        await this.claim(tx, inv.id); // first, so a second click waits here and then finds it used
        const created = await tx.user.create({ data: { email: inv.email, name: input.name, passwordHash, lastLoginAt: new Date() } });
        await this.join(tx, inv, created.id, req);
        return created;
      })
      .catch((e: unknown) => {
        // Someone registered this email at the same moment through another path
        if ((e as { code?: string }).code === 'P2002') throw new ConflictException('An account with this email already exists. Sign in, then open the invitation link again.');
        throw e;
      });
    return this.auth.startSession(user.id, user.isSuperAdmin, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  /** A signed-in user accepts an invitation sent to their email address. */
  async acceptAsSignedInUser(token: string, userId: string, req: Request) {
    const inv = await this.findUsable(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (user.email !== inv.email) throw new ForbiddenException('This invitation was sent to a different email address.');
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, inv.id);
      await this.join(tx, inv, userId, req);
    });
    return { organizationId: inv.organizationId, organizationName: inv.organization.name };
  }

  // ---- helpers ----

  private async findUsable(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { name: true, status: true } }, customRole: { select: { name: true } } },
    });
    if (!inv || inv.revokedAt) throw new NotFoundException(INVALID);
    if (inv.acceptedAt) throw new GoneException('This invitation has already been used.');
    if (inv.expiresAt <= new Date()) throw new GoneException('This invitation has expired. Ask for a new one.');
    if (inv.organization.status !== 'ACTIVE') throw new ForbiddenException('This organisation is suspended.');
    return inv;
  }

  /** Marks the invitation used. The row lock makes a simultaneous second accept wait, then fail cleanly. */
  private async claim(tx: Prisma.TransactionClient, invitationId: string) {
    const claimed = await tx.invitation.updateMany({ where: { id: invitationId, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count === 0) throw new GoneException('This invitation has already been used.');
  }

  private async join(tx: Prisma.TransactionClient, inv: { id: string; organizationId: string; builtInRole: string | null; customRoleId: string | null }, userId: string, req: Request) {

    const exists = await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: inv.organizationId } } });
    if (!exists) {
      const builtInRole = inv.builtInRole && isBuiltInRole(inv.builtInRole) && inv.builtInRole !== 'super_admin' ? inv.builtInRole : null;
      await tx.membership.create({ data: { userId, organizationId: inv.organizationId, builtInRole, customRoleId: builtInRole ? null : inv.customRoleId } });
    }
    await this.audit.record(
      { action: 'invitation.accept', actorId: userId, organizationId: inv.organizationId, entityType: 'invitation', entityId: inv.id, after: { alreadyMember: !!exists }, req },
      tx,
    );
  }
}
