import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  currencyDigits,
  guessMapping,
  looksLikeOfx,
  parseCsv,
  statementFingerprints,
  statementFromCsv,
  statementFromOfx,
  statementMappingSchema,
  type StatementLineStatus,
  type StatementMapping,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Input = {
  bankAccountId: string;
  fileName: string;
  content: string;
  mapping: StatementMapping | null;
};

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const PREVIEW_LINES = 500;

/**
 * Bank statements brought in from the bank's CSV or OFX files. The same file (or an overlapping one) never adds a
 * line twice. A CSV's layout is guessed the first time and remembered per account; it can be corrected.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async account(organizationId: string, id: string) {
    const a = await this.prisma.account.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        currency: true,
        archivedAt: true,
      },
    });
    if (!a || a.type !== 'asset' || !['bank', 'cash'].includes(a.subtype))
      throw refuse(
        BadRequestException,
        'Choose a bank or cash account.',
        'bank_invalid',
        { field: 'bankAccountId' },
      );
    if (a.archivedAt)
      throw refuse(
        BadRequestException,
        'This account is archived.',
        'account_archived',
        { field: 'bankAccountId' },
      );
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    return { ...a, digits: currencyDigits(a.currency ?? baseCurrency) };
  }

  /** Reads the file: OFX as it is; CSV with the given layout, the account's saved one, or a guess. */
  private async read(organizationId: string, input: Input) {
    const account = await this.account(organizationId, input.bankAccountId);
    if (looksLikeOfx(input.content))
      return {
        account,
        format: 'ofx' as const,
        mapping: null,
        headers: [] as string[],
        ...statementFromOfx(input.content, account.digits),
      };
    const saved = await this.prisma.bankStatementLayout.findUnique({
      where: {
        organizationId_bankAccountId: {
          organizationId,
          bankAccountId: account.id,
        },
      },
      select: { mapping: true },
    });
    const savedMapping = saved
      ? statementMappingSchema.safeParse(saved.mapping)
      : null;
    const mapping =
      input.mapping ??
      (savedMapping?.success ? savedMapping.data : null) ??
      guessMapping(input.content);
    if (!mapping)
      throw refuse(
        BadRequestException,
        'The columns couldn’t be worked out. Choose which column is the date, description and amount.',
        'layout_unknown',
        { rows: parseCsv(input.content, ',').slice(0, 10) },
      );
    const rows = parseCsv(input.content, mapping.delimiter);
    const headers = mapping.headerRows
      ? (rows[mapping.headerRows - 1] ?? [])
      : [];
    return {
      account,
      format: 'csv' as const,
      mapping,
      headers,
      ...statementFromCsv(input.content, mapping, account.digits),
    };
  }

  private async existing(
    organizationId: string,
    bankAccountId: string,
    fingerprints: string[],
  ) {
    const rows = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        bankAccountId,
        fingerprint: { in: fingerprints },
      },
      select: { fingerprint: true },
    });
    return new Set(rows.map((r) => r.fingerprint));
  }

  /** What an import would bring in, without bringing it in: the layout used, the lines, what's already there, and what can't be read. */
  async preview(organizationId: string, input: Input) {
    const r = await this.read(organizationId, input);
    const prints = statementFingerprints(r.lines);
    const have = await this.existing(organizationId, r.account.id, prints);
    const lines = r.lines.map((l, k) => ({
      ...l,
      duplicate: have.has(prints[k]!),
    }));
    const fresh = lines.filter((l) => !l.duplicate);
    return {
      format: r.format,
      mapping: r.mapping,
      headers: r.headers,
      currency: r.account.currency,
      total: lines.length,
      duplicates: lines.length - fresh.length,
      moneyIn: fresh
        .filter((l) => l.amount > 0)
        .reduce((s, l) => s + l.amount, 0),
      moneyOut: -fresh
        .filter((l) => l.amount < 0)
        .reduce((s, l) => s + l.amount, 0),
      firstDate: lines.length
        ? lines.reduce((m, l) => (l.date < m ? l.date : m), lines[0]!.date)
        : null,
      lastDate: lines.length
        ? lines.reduce((m, l) => (l.date > m ? l.date : m), lines[0]!.date)
        : null,
      lines: lines.slice(0, PREVIEW_LINES),
      issues: r.issues,
    };
  }

  /** Brings in the lines that aren't there yet, and remembers a CSV's layout for the account. */
  async import(input: Input, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const r = await this.read(organizationId, input);
    if (!r.lines.length)
      throw refuse(
        BadRequestException,
        'No transactions could be read from this file.',
        'nothing_to_import',
        { issues: r.issues.slice(0, 20) },
      );
    const prints = statementFingerprints(r.lines);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'statements:' + r.account.id}))`;
      const have = await tx.bankStatementLine.findMany({
        where: {
          organizationId,
          bankAccountId: r.account.id,
          fingerprint: { in: prints },
        },
        select: { fingerprint: true },
      });
      const seen = new Set(have.map((h) => h.fingerprint));
      const fresh = r.lines
        .map((l, k) => ({ l, print: prints[k]! }))
        .filter((x) => !seen.has(x.print));
      const dates = fresh.map((x) => x.l.date).sort();
      const imp = await tx.bankStatementImport.create({
        data: {
          organizationId,
          bankAccountId: r.account.id,
          fileName: input.fileName,
          format: r.format,
          added: fresh.length,
          duplicates: r.lines.length - fresh.length,
          rejected: r.issues.length,
          firstDate: dates.length ? asDate(dates[0]!) : null,
          lastDate: dates.length ? asDate(dates[dates.length - 1]!) : null,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      if (fresh.length)
        await tx.bankStatementLine.createMany({
          data: fresh.map(({ l, print }) => ({
            organizationId,
            bankAccountId: r.account.id,
            importId: imp.id,
            date: asDate(l.date),
            description: l.description,
            reference: l.reference,
            amount: BigInt(l.amount),
            balance: l.balance === null ? null : BigInt(l.balance),
            fingerprint: print,
          })),
        });
      if (r.mapping)
        await tx.bankStatementLayout.upsert({
          where: {
            organizationId_bankAccountId: {
              organizationId,
              bankAccountId: r.account.id,
            },
          },
          create: {
            organizationId,
            bankAccountId: r.account.id,
            mapping: r.mapping,
          },
          update: { mapping: r.mapping },
        });
      await this.audit.record(
        {
          action: 'org.banking.import',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_statement_import',
          entityId: imp.id,
          after: {
            account: `${r.account.code} ${r.account.name}`,
            file: input.fileName,
            format: r.format,
            added: fresh.length,
            duplicates: r.lines.length - fresh.length,
            rejected: r.issues.length,
          },
          req: ctx.req,
        },
        tx,
      );
      return {
        id: imp.id,
        added: fresh.length,
        duplicates: r.lines.length - fresh.length,
      };
    });
    return { ...result, rejected: r.issues.length, issues: r.issues };
  }

  async imports(organizationId: string, bankAccountId: string) {
    const rows = await this.prisma.bankStatementImport.findMany({
      where: { organizationId, bankAccountId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        format: true,
        added: true,
        duplicates: true,
        rejected: true,
        firstDate: true,
        lastDate: true,
        createdAt: true,
        _count: {
          select: { lines: { where: { status: { not: 'unmatched' } } } },
        },
      },
    });
    return rows.map((i) => ({
      id: i.id,
      fileName: i.fileName,
      format: i.format,
      added: i.added,
      duplicates: i.duplicates,
      rejected: i.rejected,
      firstDate: i.firstDate && iso(i.firstDate),
      lastDate: i.lastDate && iso(i.lastDate),
      createdAt: i.createdAt,
      reconciled: i._count.lines,
    }));
  }

  async lines(
    organizationId: string,
    q: {
      bankAccountId: string;
      status?: StatementLineStatus;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.BankStatementLineWhereInput = {
      organizationId,
      bankAccountId: q.bankAccountId,
      ...(q.status && { status: q.status }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.bankStatementLine.count({ where }),
      this.prisma.bankStatementLine.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          date: true,
          description: true,
          reference: true,
          amount: true,
          balance: true,
          status: true,
          importId: true,
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((l) => ({
        ...l,
        date: iso(l.date),
        amount: Number(l.amount),
        balance: l.balance === null ? null : Number(l.balance),
        status: l.status as StatementLineStatus,
      })),
    };
  }

  /** Takes an import back out, as long as none of its lines has been reconciled. */
  async undo(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const imp = await tx.bankStatementImport.findFirst({
        where: { organizationId, id },
        select: { id: true, fileName: true, added: true },
      });
      if (!imp) throw new NotFoundException('Import not found.');
      if (
        await tx.bankStatementLine.count({
          where: { organizationId, importId: id, status: { not: 'unmatched' } },
        })
      )
        throw refuse(
          ConflictException,
          'Some of these lines have been reconciled. Undo that first.',
          'has_reconciled',
        );
      await tx.bankStatementLine.deleteMany({
        where: { organizationId, importId: id },
      });
      await tx.bankStatementImport.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.banking.import_undo',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_statement_import',
          entityId: id,
          before: { file: imp.fileName, added: imp.added },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
