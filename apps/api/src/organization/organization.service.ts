import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { LOGO_MAX_BYTES, sniffLogoType, type LogoUpload, type OrganizationSettingsUpdate } from '@ledgernest/shared';
import type { Request } from 'express';
import { TenantPrisma } from '../access/tenant-prisma.js';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const select = {
  id: true,
  name: true,
  slug: true,
  status: true,
  baseCurrency: true,
  locale: true,
  timeZone: true,
  country: true,
  fiscalYearStartMonth: true,
  legalName: true,
  taxId: true,
  email: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  invoiceTerms: true,
  upiId: true,
  weeklySummary: true,
  requireTwoFactor: true,
  msmeCategory: true,
  udyamNumber: true,
  msmeBankRateBp: true,
  createdAt: true,
  updatedAt: true,
  logo: { select: { contentType: true, updatedAt: true } },
} as const;

/** Settings stored as columns, keyed the way the audit log records them. */
type Columns = Partial<{
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  baseCurrency: string;
  locale: string;
  timeZone: string;
  fiscalYearStartMonth: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  invoiceTerms: string | null;
  upiId: string | null;
  weeklySummary: boolean;
  requireTwoFactor: boolean;
  msmeCategory: string | null;
  udyamNumber: string | null;
  msmeBankRateBp: number | null;
}>;

const ADDRESS_COLUMNS = { line1: 'addressLine1', line2: 'addressLine2', city: 'city', region: 'region', postalCode: 'postalCode' } as const;

/** An organisation's own settings: company details, money, dates, and its logo. */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * Settings that can no longer change. The fiscal year start locks once financial years exist,
   * because their periods were cut from it. The base currency locks once anything is posted: every amount is in it.
   */
  private async locks(organizationId: string) {
    const [years, posted] = await Promise.all([this.prisma.fiscalYear.count({ where: { organizationId } }), JournalsService.anyPosted(this.prisma, organizationId)]);
    return { baseCurrency: posted, fiscalYearStartMonth: years > 0 };
  }

  async get(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select });
    const { addressLine1, addressLine2, city, region, postalCode, logo, ...rest } = org;
    return {
      ...rest,
      address: { line1: addressLine1, line2: addressLine2, city, region, postalCode },
      logo: logo && { contentType: logo.contentType, updatedAt: logo.updatedAt },
      locks: await this.locks(organizationId),
    };
  }

  async update(input: OrganizationSettingsUpdate, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const { address, ...fields } = input;
    const wanted: Columns = { ...fields };
    for (const [k, column] of Object.entries(ADDRESS_COLUMNS)) {
      const v = address?.[k as keyof typeof ADDRESS_COLUMNS];
      if (v !== undefined) wanted[column] = v;
    }

    const current = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select });
    // Only what actually changes is written and audited
    const changed = (Object.keys(wanted) as (keyof Columns)[]).filter((k) => wanted[k] !== current[k]);
    if (!changed.length) return this.get(organizationId);

    // Requiring two-factor starts with yourself, so no one locks themselves out
    if (changed.includes('requireTwoFactor') && wanted.requireTwoFactor) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { totpEnabledAt: true } });
      if (!me.totpEnabledAt) throw refuse(ConflictException, 'Turn on two-factor sign-in for yourself first.', 'two_factor_self', { field: 'requireTwoFactor' });
    }

    const locks = await this.locks(organizationId);
    for (const field of ['baseCurrency', 'fiscalYearStartMonth'] as const) {
      if (changed.includes(field) && locks[field]) {
        throw refuse(ConflictException, field === 'baseCurrency' ? 'The base currency can’t change once entries are posted.' : 'The fiscal year start can’t change once fiscal years exist.', 'locked', { field });
      }
    }

    if (changed.includes('baseCurrency') && (await this.prisma.organizationCurrency.findUnique({ where: { organizationId_code: { organizationId, code: wanted.baseCurrency as string } } }))) {
      throw refuse(ConflictException, 'That currency is enabled as a foreign currency. Remove it under Currencies first.', 'currency_enabled', { field: 'baseCurrency' });
    }

    const data = Object.fromEntries(changed.map((k) => [k, wanted[k]]));
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data });
      await this.audit.record(
        {
          action: 'org.settings.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'organization',
          entityId: organizationId,
          before: Object.fromEntries(changed.map((k) => [k, current[k]])),
          after: data,
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId);
  }

  /** Stores a logo after checking its bytes really are the PNG, JPEG or WebP it claims to be. */
  async setLogo(upload: LogoUpload, ctx: Ctx) {
    const bytes = Buffer.from(upload.data, 'base64');
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) throw refuse(BadRequestException, 'Use an image under 256 KB.', 'too_large');
    if (sniffLogoType(bytes) !== upload.type) throw refuse(BadRequestException, 'That file isn’t the image type it claims to be.', 'type_mismatch');

    const db = this.tenantPrisma.db;
    const previous = await db.organizationLogo.findFirst({ select: { contentType: true, data: true } });
    await db.organizationLogo.upsert({
      where: { organizationId: ctx.tenant.organizationId },
      create: { organizationId: ctx.tenant.organizationId, contentType: upload.type, data: bytes },
      update: { contentType: upload.type, data: bytes },
    });
    await this.audit.record({
      action: 'org.logo.update',
      actorId: ctx.actor.userId,
      organizationId: ctx.tenant.organizationId,
      entityType: 'organization',
      entityId: ctx.tenant.organizationId,
      before: previous && { contentType: previous.contentType, bytes: previous.data.length },
      after: { contentType: upload.type, bytes: bytes.length },
      req: ctx.req,
    });
    return this.get(ctx.tenant.organizationId);
  }

  async removeLogo(ctx: Ctx) {
    const { count } = await this.tenantPrisma.db.organizationLogo.deleteMany({});
    if (count) {
      await this.audit.record({
        action: 'org.logo.remove',
        actorId: ctx.actor.userId,
        organizationId: ctx.tenant.organizationId,
        entityType: 'organization',
        entityId: ctx.tenant.organizationId,
        req: ctx.req,
      });
    }
  }

  logo() {
    return this.tenantPrisma.db.organizationLogo.findFirst({ select: { contentType: true, data: true, updatedAt: true } });
  }

  /**
   * Deletes the organisation and everything in it, for an Owner who typed its name. The audit log keeps a platform
   * entry saying who deleted what, when; the organisation's own entries stay, no longer tied to it.
   */
  async remove(confirmName: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, slug: true },
    });
    if (confirmName.trim() !== org.name.trim())
      throw refuse(
        BadRequestException,
        'The name doesn’t match. Type the organisation’s name exactly as it is.',
        'name_mismatch',
        { field: 'confirmName' },
      );
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(
        {
          action: 'organization.deleted',
          actorId: ctx.actor.userId,
          organizationId: null,
          entityType: 'organization',
          entityId: organizationId,
          before: { name: org.name, slug: org.slug },
          req: ctx.req,
        },
        tx,
      );
      await tx.organization.delete({ where: { id: organizationId } });
    });
  }
}
