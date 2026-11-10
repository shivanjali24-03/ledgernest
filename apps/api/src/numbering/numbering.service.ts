import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_SERIES,
  NUMBERED_DOCUMENTS,
  DOC_NUMBER_MAX,
  fiscalYearName,
  fiscalYearOf,
  formatDocNumber,
  nextSerial,
  seriesPreview,
  seriesProblems,
  todayIn,
  type NumberSeriesUpdate,
  type NumberSeriesValues,
  type NumberedDocument,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;
type Ctx = { actor: Actor; tenant: Tenant; req: Request };

/** The table each numbered document lives in */
const TABLE: Record<NumberedDocument, string> = {
  invoice: 'invoices',
  credit_note: 'credit_notes',
  debit_note: 'vendor_credits',
};
const LEGACY_PREFIX: Record<NumberedDocument, string> = {
  invoice: 'INV',
  credit_note: 'CN',
  debit_note: 'DN',
};

const refuse = (
  E: typeof BadRequestException | typeof ConflictException,
  message: string,
  reason: string,
  extra: object = {},
) => new E({ message, details: { reason, ...extra } });

/**
 * Number series: each organisation's prefixes and suffixes per document type (shared numbering/). A document takes
 * its number when it's issued, from its series, inside the issuing transaction: the series is locked, the next
 * serial found from the highest given (this financial year, if the series starts again each year), and the number
 * written onto the document so later changes to the series never renumber it.
 */
@Injectable()
export class NumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Makes sure the organisation has a series for the type (the one numbers always came from), and gives documents
   * numbered before series existed (e.g. from a restored older backup) their written number and series.
   */
  async ensure(tx: Tx, organizationId: string, type: NumberedDocument) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'numbering:' + organizationId}))`;
    let def = await tx.numberSeries.findFirst({
      where: { organizationId, type, isDefault: true },
    });
    if (!def) {
      const any = await tx.numberSeries.findFirst({
        where: { organizationId, type, archived: false },
        orderBy: { createdAt: 'asc' },
      });
      def = any
        ? await tx.numberSeries.update({
            where: { id: any.id },
            data: { isDefault: true },
          })
        : await tx.numberSeries.create({
            data: {
              organizationId,
              type,
              ...DEFAULT_SERIES[type],
              isDefault: true,
            },
          });
    }
    const table = TABLE[type];
    const prefix = LEGACY_PREFIX[type];
    // The table name is one of three constants above, never input
    await tx.$executeRawUnsafe(
      `UPDATE "${table}" d SET "series_id" = $2::uuid,
         "full_number" = $3 || '/' || replace(regexp_replace(y."name", '^FY\\s*', ''), '–', '-') || '/' || CASE WHEN length(d."number"::text) >= 4 THEN d."number"::text ELSE lpad(d."number"::text, 4, '0') END
       FROM "fiscal_years" y
       WHERE d."organization_id" = $1::uuid AND d."series_id" IS NULL AND d."number" IS NOT NULL AND y."id" = d."fiscal_year_id"`,
      organizationId,
      def.id,
      prefix,
    );
    return def;
  }

  /** The next number in a series (the type's default if none is chosen), for a document dated in the given year */
  async allocate(
    tx: Tx,
    organizationId: string,
    type: NumberedDocument,
    seriesId: string | null | undefined,
    year: { id: string; name: string },
  ) {
    const def = await this.ensure(tx, organizationId, type);
    const series = seriesId
      ? await tx.numberSeries.findFirst({
          where: { organizationId, type, id: seriesId },
        })
      : def;
    if (!series || series.archived)
      throw refuse(
        ConflictException,
        'That number series isn’t in use any more. Choose another.',
        'series_archived',
      );
    const where = series.resetYearly
      ? { seriesId: series.id, fiscalYearId: year.id }
      : { seriesId: series.id };
    const highest =
      type === 'invoice'
        ? (await tx.invoice.aggregate({ where, _max: { number: true } }))._max
            .number
        : type === 'credit_note'
          ? (await tx.creditNote.aggregate({ where, _max: { number: true } }))
              ._max.number
          : (await tx.vendorCredit.aggregate({ where, _max: { number: true } }))
              ._max.number;
    const number = nextSerial(highest, series.startNumber);
    const fullNumber = formatDocNumber(series, year.name, number);
    if (fullNumber.length > DOC_NUMBER_MAX)
      throw refuse(
        ConflictException,
        `${fullNumber} is longer than the 16 characters GST allows. Shorten the series’ prefix or suffix.`,
        'number_too_long',
        { number: fullNumber },
      );
    return { seriesId: series.id, number, fullNumber };
  }

  /** The current financial year's name, for previews */
  private async yearName(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true, fiscalYearStartMonth: true },
    });
    const today = todayIn(org.timeZone);
    const year = await this.prisma.fiscalYear.findFirst({
      where: {
        organizationId,
        startDate: { lte: new Date(today) },
        endDate: { gte: new Date(today) },
      },
      select: { name: true },
    });
    if (year) return year.name;
    return fiscalYearName(
      fiscalYearOf(today, org.fiscalYearStartMonth),
      org.fiscalYearStartMonth,
    );
  }

  async list(organizationId: string) {
    await this.prisma.$transaction(async (tx) => {
      for (const t of NUMBERED_DOCUMENTS)
        await this.ensure(tx, organizationId, t);
    });
    const rows = await this.prisma.numberSeries.findMany({
      where: { organizationId },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { invoices: true, creditNotes: true, vendorCredits: true },
        },
      },
    });
    const yearName = await this.yearName(organizationId);
    const order = (t: string) =>
      NUMBERED_DOCUMENTS.indexOf(t as NumberedDocument);
    return {
      yearName,
      items: rows
        .sort((a, b) => order(a.type) - order(b.type))
        .map((r) => this.view(r, yearName)),
    };
  }

  private view(
    r: Prisma.NumberSeriesGetPayload<{
      include: {
        _count: {
          select: { invoices: true; creditNotes: true; vendorCredits: true };
        };
      };
    }>,
    yearName: string,
  ) {
    return {
      id: r.id,
      type: r.type as NumberedDocument,
      name: r.name,
      prefix: r.prefix,
      suffix: r.suffix,
      digits: r.digits,
      startNumber: r.startNumber,
      resetYearly: r.resetYearly,
      isDefault: r.isDefault,
      archived: r.archived,
      preview: seriesPreview(r, yearName),
      used: r._count.invoices + r._count.creditNotes + r._count.vendorCredits,
    };
  }

  private async check(
    organizationId: string,
    v: Pick<NumberSeriesValues, 'prefix' | 'suffix' | 'digits' | 'startNumber'>,
  ) {
    const yearName = await this.yearName(organizationId);
    const problems = seriesProblems(v, yearName);
    if (problems.includes('too_long'))
      throw refuse(
        BadRequestException,
        `Numbers like ${formatDocNumber(v, yearName, Math.max(10 ** v.digits - 1, v.startNumber))} would be longer than the 16 characters GST allows.`,
        'too_long',
        { field: 'prefix' },
      );
    if (problems.includes('no_room'))
      throw refuse(
        BadRequestException,
        'The start number has more digits than the series allows.',
        'no_room',
        { field: 'startNumber' },
      );
  }

  private async one(organizationId: string, id: string) {
    const r = await this.prisma.numberSeries.findFirst({
      where: { organizationId, id },
      include: {
        _count: {
          select: { invoices: true, creditNotes: true, vendorCredits: true },
        },
      },
    });
    if (!r) throw new NotFoundException('Number series not found.');
    return r;
  }

  async create(v: NumberSeriesValues, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.check(organizationId, v);
    const created = await this.prisma.$transaction(async (tx) => {
      await this.ensure(tx, organizationId, v.type);
      if (
        await tx.numberSeries.findFirst({
          where: {
            organizationId,
            type: v.type,
            name: { equals: v.name, mode: 'insensitive' },
          },
        })
      )
        throw refuse(
          ConflictException,
          'There is already a series with that name.',
          'name_taken',
          { field: 'name' },
        );
      if (v.isDefault)
        await tx.numberSeries.updateMany({
          where: { organizationId, type: v.type },
          data: { isDefault: false },
        });
      const s = await tx.numberSeries.create({
        data: { organizationId, ...v },
      });
      await this.audit.record(
        {
          action: 'org.number_series.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'number_series',
          entityId: s.id,
          after: v,
          req: ctx.req,
        },
        tx,
      );
      return s;
    });
    return this.view(
      await this.one(organizationId, created.id),
      await this.yearName(organizationId),
    );
  }

  async update(id: string, patch: NumberSeriesUpdate, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const current = await this.one(organizationId, id);
    const next = {
      name: patch.name ?? current.name,
      prefix: patch.prefix ?? current.prefix,
      suffix: patch.suffix ?? current.suffix,
      digits: patch.digits ?? current.digits,
      startNumber: patch.startNumber ?? current.startNumber,
      resetYearly: patch.resetYearly ?? current.resetYearly,
      isDefault: patch.isDefault ?? current.isDefault,
      archived: patch.archived ?? current.archived,
    };
    await this.check(organizationId, next);
    if (current.isDefault && (!next.isDefault || next.archived))
      throw refuse(
        ConflictException,
        'Make another series the default first.',
        'default_needed',
      );
    if (next.isDefault && next.archived)
      throw refuse(
        ConflictException,
        'The default series can’t be archived.',
        'default_needed',
      );
    await this.prisma.$transaction(async (tx) => {
      if (
        next.name.toLowerCase() !== current.name.toLowerCase() &&
        (await tx.numberSeries.findFirst({
          where: {
            organizationId,
            type: current.type,
            name: { equals: next.name, mode: 'insensitive' },
          },
        }))
      )
        throw refuse(
          ConflictException,
          'There is already a series with that name.',
          'name_taken',
          { field: 'name' },
        );
      if (next.isDefault && !current.isDefault)
        await tx.numberSeries.updateMany({
          where: { organizationId, type: current.type },
          data: { isDefault: false },
        });
      await tx.numberSeries.update({ where: { id }, data: next });
      await this.audit.record(
        {
          action: 'org.number_series.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'number_series',
          entityId: id,
          before: {
            name: current.name,
            prefix: current.prefix,
            suffix: current.suffix,
            digits: current.digits,
            startNumber: current.startNumber,
            resetYearly: current.resetYearly,
            isDefault: current.isDefault,
            archived: current.archived,
          },
          after: next,
          req: ctx.req,
        },
        tx,
      );
    });
    return this.view(
      await this.one(organizationId, id),
      await this.yearName(organizationId),
    );
  }

  /** Only a series that never numbered anything can be deleted; others are archived */
  async remove(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.one(organizationId, id);
    const used =
      r._count.invoices + r._count.creditNotes + r._count.vendorCredits;
    if (used)
      throw refuse(
        ConflictException,
        'This series has numbered documents. Archive it instead.',
        'in_use',
      );
    if (r.isDefault)
      throw refuse(
        ConflictException,
        'Make another series the default first.',
        'default_needed',
      );
    await this.prisma.$transaction(async (tx) => {
      // Drafts that chose it go back to the default
      await tx.invoice.updateMany({
        where: { organizationId, seriesId: id },
        data: { seriesId: null },
      });
      await tx.numberSeries.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.number_series.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'number_series',
          entityId: id,
          before: { name: r.name, type: r.type },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
