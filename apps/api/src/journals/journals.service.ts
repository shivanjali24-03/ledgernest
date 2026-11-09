import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ATTACHMENT_MAX_BYTES, currencyDigits, realisedDifferences, enteredLines, expandTax, journalNumber, postingProblem, sniffAttachmentType, toBase, totals, type AttachmentType, type EnteredLine, type ExpandedLine } from '@ledgernest/shared';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { dayStatus } from '../periods/day-status.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type LineIn = EnteredLine;
/** A line as stored: what was entered (with its net amount when taxed) or a tax line generated from it */
type LineRow = ExpandedLine;
type DraftIn = { date: string; memo: string | null; reference: string | null; lines: LineIn[] };

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const entrySelect = {
  id: true,
  number: true,
  date: true,
  memo: true,
  reference: true,
  status: true,
  reversalOfId: true,
  postedAt: true,
  createdAt: true,
  updatedAt: true,
  fiscalYear: { select: { name: true } },
  reversalOf: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
  reversedBy: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
  createdBy: { select: { name: true, email: true } },
  postedBy: { select: { name: true, email: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      id: true,
      lineNo: true,
      accountId: true,
      description: true,
      debit: true,
      credit: true,
      taxGroupId: true,
      taxInclusive: true,
      taxRateId: true,
      taxSourceLine: true,
      currency: true,
      foreignDebit: true,
      foreignCredit: true,
      rate: true,
      fxSourceLine: true,
      account: { select: { code: true, name: true, type: true, currency: true } },
      taxGroup: { select: { id: true, name: true } },
      taxRate: { select: { id: true, name: true, kind: true, ratePpm: true } },
    },
  },
  attachments: { orderBy: { createdAt: 'asc' as const }, select: { id: true, fileName: true, contentType: true, size: true, createdAt: true } },
} as const;
type EntryRow = Prisma.JournalEntryGetPayload<{ select: typeof entrySelect }>;

const label = (e: { number: number | null; fiscalYear: { name: string } | null } | null) => (e?.number && e.fiscalYear ? journalNumber(e.fiscalYear.name, e.number) : null);

/**
 * Journal entries. Drafts can change; posting checks balance, accounts and an open period and assigns
 * a gap-free number. Posted entries are final (the database refuses changes too); reversals correct them.
 */
@Injectable()
export class JournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'journals:' + organizationId}))`;
  }

  private view(e: EntryRow) {
    const lines = e.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      accountId: l.accountId,
      account: l.account,
      description: l.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
      taxGroup: l.taxGroup,
      taxInclusive: l.taxInclusive,
      /** Set on a tax line the system generated */
      taxRate: l.taxRate,
      taxSourceLine: l.taxSourceLine,
      /** A foreign-currency line: the amount in that currency and the rate it was converted at */
      currency: l.currency,
      foreignDebit: Number(l.foreignDebit),
      foreignCredit: Number(l.foreignCredit),
      rate: l.rate && rateText(l.rate),
      /** Set on an exchange-difference line generated on posting */
      fxSourceLine: l.fxSourceLine,
    }));
    return {
      id: e.id,
      number: label(e),
      date: iso(e.date),
      memo: e.memo,
      reference: e.reference,
      status: e.status as 'draft' | 'posted',
      postedAt: e.postedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      createdBy: e.createdBy,
      postedBy: e.postedBy,
      reversalOf: e.reversalOf && { id: e.reversalOf.id, number: label(e.reversalOf) },
      reversedBy: e.reversedBy && { id: e.reversedBy.id, number: label(e.reversedBy) },
      lines,
      totals: totals(lines),
      attachments: e.attachments,
    };
  }

  private async find(tx: Tx | PrismaService, organizationId: string, id: string) {
    const e = await tx.journalEntry.findFirst({ where: { id, organizationId }, select: entrySelect });
    if (!e) throw new NotFoundException('Journal entry not found.');
    return e;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  /** Entries newest first, with their totals. Filters: status, date range, an account they touch, text in memo or reference. */
  async list(organizationId: string, q: { status?: 'draft' | 'posted'; from?: string; to?: string; accountId?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.JournalEntryWhereInput = {
      organizationId,
      ...(q.status && { status: q.status }),
      ...((q.from || q.to) && { date: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }),
      ...(q.accountId && { lines: { some: { accountId: q.accountId } } }),
      ...(q.search && { OR: [{ memo: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }] }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { ...entrySelect, attachments: { select: { id: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((e) => {
        const t = totals(e.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })));
        return { id: e.id, number: label(e), date: iso(e.date), memo: e.memo, reference: e.reference, status: e.status, lineCount: e.lines.length, totals: t, reversalOf: e.reversalOf && { id: e.reversalOf.id, number: label(e.reversalOf) }, reversed: !!e.reversedBy, attachmentCount: e.attachments.length };
      }),
    };
  }

  /** Lines may only use active accounts of this organisation. */
  private async checkAccounts(tx: Tx, organizationId: string, lines: { accountId: string }[]) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    if (!ids.length) return new Map<string, { type: string; currency: string | null }>();
    const found = await tx.account.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, type: true, currency: true, archivedAt: true } });
    if (found.length !== ids.length) throw refuse(BadRequestException, 'A line uses an account that doesn’t exist.', 'account_not_found');
    if (found.some((a) => a.archivedAt)) throw refuse(BadRequestException, 'A line uses an archived account.', 'account_archived');
    return new Map(found.map((a) => [a.id, a]));
  }

  /**
   * Turns the lines as entered into the lines stored. A taxed line keeps its net amount and is followed by
   * one generated line per tax component, on the same side: sales (credits to income) credit output tax,
   * purchases (debits to expenses or assets) debit input tax, and credit notes run the other way.
   */
  private async expand(tx: Tx, organizationId: string, date: string, entered: LineIn[]): Promise<LineRow[]> {
    const accounts = await this.checkAccounts(tx, organizationId, entered);
    const lines = await this.convert(tx, organizationId, date, entered, accounts);
    const groupIds = [...new Set(lines.map((l) => l.taxGroupId).filter((g): g is string => !!g))];
    const groups = groupIds.length
      ? await tx.taxGroup.findMany({
          where: { organizationId, id: { in: groupIds } },
          select: { id: true, archivedAt: true, rates: { orderBy: { position: 'asc' }, select: { rate: { select: { id: true, ratePpm: true, outputAccountId: true, inputAccountId: true } } } } },
        })
      : [];
    if (groups.length !== groupIds.length) throw refuse(BadRequestException, 'A line uses a tax group that doesn’t exist.', 'tax_group_not_found');
    if (groups.some((g) => g.archivedAt)) throw refuse(BadRequestException, 'A line uses an archived tax group.', 'tax_group_archived');
    const byId = new Map(groups.map((g) => [g.id, g.rates.map((r) => r.rate)]));
    const { rows, tooSmall } = expandTax(lines, (id) => byId.get(id), (id) => accounts.get(id)?.type);
    if (tooSmall !== null) throw refuse(BadRequestException, 'This amount is too small to carry the tax.', 'tax_too_small', { line: tooSmall });
    // The tax accounts must be usable too
    await this.checkAccounts(tx, organizationId, rows.filter((r) => r.taxRateId));
    return rows;
  }

  /**
   * Lines on a foreign-currency account are entered in that currency and converted to the base currency at the
   * line's rate, or the rate on the entry's date. Lines on other accounts are in the base currency.
   */
  private async convert(tx: Tx, organizationId: string, date: string, lines: LineIn[], accounts: Map<string, { type: string; currency: string | null }>): Promise<LineIn[]> {
    if (!lines.some((l) => l.currency || accounts.get(l.accountId)?.currency)) return lines;
    const { baseCurrency } = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
    const out: LineIn[] = [];
    for (const [i, l] of lines.entries()) {
      const accountCurrency = accounts.get(l.accountId)?.currency ?? null;
      if (accountCurrency && l.currency !== accountCurrency) throw refuse(BadRequestException, `This account is kept in ${accountCurrency}: enter the line in ${accountCurrency}.`, 'currency_required', { line: i + 1, currency: accountCurrency });
      if (!l.currency) {
        out.push(l);
        continue;
      }
      if (l.currency !== accountCurrency) throw refuse(BadRequestException, 'Only foreign-currency accounts take foreign amounts.', 'currency_mismatch', { line: i + 1 });
      const rate = l.rate ?? (await rateOn(tx, organizationId, l.currency, date))?.rate;
      if (!rate) throw refuse(BadRequestException, `There is no ${l.currency} rate on or before ${date}. Add one under Currencies, or type the rate on the line.`, 'no_rate', { line: i + 1, currency: l.currency, date });
      const foreign = (l.foreignDebit ?? 0) || (l.foreignCredit ?? 0);
      const base = toBase(foreign, rate, currencyDigits(l.currency), currencyDigits(baseCurrency));
      if (base <= 0) throw refuse(BadRequestException, 'This amount is too small to show in the base currency.', 'amount_too_small', { line: i + 1 });
      out.push({ ...l, rate, debit: l.foreignDebit ? base : 0, credit: l.foreignDebit ? 0 : base });
    }
    return out;
  }

  /**
   * Realised exchange difference, worked out when an entry posts. A foreign-currency account carries its balance
   * at an average rate; a line that reduces the balance (a receivable collected, a payable paid) takes out the
   * carrying amount of the part it settles. When that differs from the line's own base amount, a generated pair
   * of lines adjusts the account and books the difference to Realised exchange gain or loss.
   */
  private async addRealised(tx: Tx, organizationId: string, e: EntryRow) {
    const foreign = e.lines.filter((l) => l.currency && !l.fxSourceLine);
    if (!foreign.length) return;
    const before = new Map<string, { foreign: number; base: number }>();
    for (const accountId of new Set(foreign.map((l) => l.accountId))) {
      const [r] = await tx.$queryRaw<{ f: bigint | null; b: bigint | null }[]>`
        SELECT sum(l.foreign_debit - l.foreign_credit)::bigint AS f, sum(l.debit - l.credit)::bigint AS b
        FROM journal_lines l JOIN journal_entries x ON x.id = l.entry_id
        WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND x.status = 'posted'`;
      before.set(accountId, { foreign: Number(r?.f ?? 0), base: Number(r?.b ?? 0) });
    }
    const differences = realisedDifferences(
      foreign.map((l) => ({ lineNo: l.lineNo, accountId: l.accountId, currency: l.currency, foreignDebit: Number(l.foreignDebit), foreignCredit: Number(l.foreignCredit), debit: Number(l.debit), credit: Number(l.credit) })),
      (id) => before.get(id)!,
    );
    const extra: LineRow[] = [];
    let lineNo = e.lines.length;
    for (const d of differences) {
      const fxAccount = await ensureFxAccount(tx, organizationId, 'fx_realised');
      const amount = Math.abs(d.adjust);
      const onAccount = d.adjust > 0 ? { debit: amount, credit: 0 } : { debit: 0, credit: amount };
      const base = { description: null, taxGroupId: null, taxInclusive: false, taxRateId: null, taxSourceLine: null, foreignDebit: 0, foreignCredit: 0, rate: null, fxSourceLine: d.sourceLine };
      extra.push({ ...base, lineNo: ++lineNo, accountId: d.accountId, currency: d.currency, ...onAccount });
      extra.push({ ...base, lineNo: ++lineNo, accountId: fxAccount, currency: null, debit: onAccount.credit, credit: onAccount.debit });
    }
    if (extra.length) await tx.journalLine.createMany({ data: extra.map((r) => this.dbRow(organizationId, e.id, r)) });
  }

  private dbRow(organizationId: string, entryId: string, r: LineRow) {
    return { organizationId, entryId, ...r, debit: BigInt(r.debit), credit: BigInt(r.credit), foreignDebit: BigInt(r.foreignDebit), foreignCredit: BigInt(r.foreignCredit) };
  }

  private async writeRows(tx: Tx, organizationId: string, entryId: string, rows: LineRow[]) {
    await tx.journalLine.deleteMany({ where: { entryId } });
    if (rows.length) await tx.journalLine.createMany({ data: rows.map((r) => this.dbRow(organizationId, entryId, r)) });
  }

  private async writeLines(tx: Tx, organizationId: string, entryId: string, date: string, lines: LineIn[]) {
    const rows = await this.expand(tx, organizationId, date, lines);
    await this.writeRows(tx, organizationId, entryId, rows);
    return totals(rows);
  }

  /** The lines as they were entered, from the stored ones (inclusive amounts get their tax added back). */
  private static entered(lines: EntryRow['lines']): LineIn[] {
    return enteredLines(lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), foreignDebit: Number(l.foreignDebit), foreignCredit: Number(l.foreignCredit), rate: l.rate && rateText(l.rate) })));
  }

  async createDraft(input: DraftIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({ data: { organizationId, date: asDate(input.date), memo: input.memo, reference: input.reference, createdById: ctx.actor.userId }, select: { id: true } });
      const t = await this.writeLines(tx, organizationId, e.id, input.date, input.lines);
      await this.audit.record({ action: 'org.journal.create', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: e.id, after: { date: input.date, memo: input.memo, lines: input.lines.length, ...t }, req: ctx.req }, tx);
      return e.id;
    });
    return this.get(organizationId, id);
  }

  async updateDraft(id: string, input: DraftIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const e = await this.find(tx, organizationId, id);
      if (e.status !== 'draft') throw refuse(ConflictException, 'Posted entries can’t be changed. Reverse it instead.', 'posted');
      await tx.journalEntry.update({ where: { id }, data: { date: asDate(input.date), memo: input.memo, reference: input.reference } });
      const t = await this.writeLines(tx, organizationId, id, input.date, input.lines);
      const before = this.view(e);
      await this.audit.record(
        { action: 'org.journal.update', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, before: { date: before.date, memo: before.memo, lines: before.lines.length, ...before.totals }, after: { date: input.date, memo: input.memo, lines: input.lines.length, ...t }, req: ctx.req },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  async deleteDraft(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const e = await this.find(tx, organizationId, id);
      if (e.status !== 'draft') throw refuse(ConflictException, 'Posted entries can’t be deleted. Reverse it instead.', 'posted');
      await tx.journalEntry.delete({ where: { id } });
      await this.audit.record({ action: 'org.journal.delete', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, before: { date: iso(e.date), memo: e.memo, lines: e.lines.length }, req: ctx.req }, tx);
    });
  }

  /** Checks the date is in an open period and returns its financial year. */
  private async openYearFor(tx: Tx, organizationId: string, day: string) {
    const status = await dayStatus(tx, organizationId, day);
    if (status === 'no_period') throw refuse(ConflictException, 'There is no financial year for this date. Add it under Financial years.', 'no_period');
    if (status === 'closed') throw refuse(ConflictException, 'This date is in a closed month.', 'period_closed');
    return tx.fiscalYear.findFirstOrThrow({ where: { organizationId, startDate: { lte: asDate(day) }, endDate: { gte: asDate(day) } }, select: { id: true, name: true } });
  }

  /** Gives a draft its number and makes it final. */
  private async postInTx(tx: Tx, organizationId: string, id: string, actorId: string, { recomputeTax = true, system = false } = {}) {
    let e = await this.find(tx, organizationId, id);
    if (e.status !== 'draft') throw refuse(ConflictException, 'This entry is already posted.', 'posted');
    // Tax lines are recomputed from the current rates' accounts, so a draft saved before an account changed posts correctly
    if (recomputeTax && e.lines.some((l) => l.taxGroupId || l.taxRateId)) {
      await this.writeLines(tx, organizationId, id, iso(e.date), JournalsService.entered(e.lines));
      e = await this.find(tx, organizationId, id);
    }
    // Settling foreign balances realises exchange differences (a reversal mirrors the original's instead)
    if (recomputeTax && e.lines.some((l) => l.currency && !l.fxSourceLine)) {
      await this.addRealised(tx, organizationId, e);
      e = await this.find(tx, organizationId, id);
    }
    const lines = e.lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }));
    const problem = postingProblem(lines);
    if (problem) throw refuse(BadRequestException, problem === 'unbalanced' ? 'Debits and credits must be equal.' : problem === 'zero' ? 'The entry has no amounts.' : 'An entry needs at least two lines.', problem, totals(lines));
    // System entries (the year-end close) may touch archived accounts: their balances still have to move
    if (!system) await this.checkAccounts(tx, organizationId, e.lines.map((l) => ({ accountId: l.accountId, description: null, debit: 0, credit: 0 })));
    const year = await this.openYearFor(tx, organizationId, iso(e.date));
    const last = await tx.journalEntry.aggregate({ where: { organizationId, fiscalYearId: year.id }, _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    await tx.journalEntry.update({ where: { id }, data: { status: 'posted', number, fiscalYearId: year.id, postedAt: new Date(), postedById: actorId } });
    return { number: journalNumber(year.name, number), totals: totals(lines), date: iso(e.date) };
  }

  async post(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const r = await this.postInTx(tx, organizationId, id, ctx.actor.userId);
      await this.audit.record({ action: 'org.journal.post', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, after: { number: r.number, date: r.date, ...r.totals }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }

  /** Corrects a posted entry with its exact opposite, linked both ways. The original stays untouched. */
  async reverse(id: string, input: { date?: string; memo: string | null }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const reversalId = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const invoice = await tx.invoice.findFirst({ where: { organizationId, OR: [{ journalEntryId: id }, { voidEntryId: id }] }, select: { id: true } });
      if (invoice) throw refuse(ConflictException, 'This entry belongs to an invoice. Void the invoice instead.', 'document_entry', { invoiceId: invoice.id });
      if (await tx.fiscalYear.findFirst({ where: { organizationId, closingEntryId: id }, select: { id: true } })) {
        throw refuse(ConflictException, 'This entry closed a financial year. Reopen the year’s last month instead, which reverses it.', 'closing_entry');
      }
      const r = await this.reverseInTx(tx, organizationId, id, ctx.actor.userId, input);
      await this.audit.record({ action: 'org.journal.reverse', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, after: { original: r.original, reversal: r.number, date: r.date }, req: ctx.req }, tx);
      return r.id;
    });
    return this.get(organizationId, reversalId);
  }

  /** The reversal itself, inside the caller's transaction (the year-end reopen uses it too). */
  async reverseInTx(tx: Tx, organizationId: string, id: string, actorId: string, input: { date?: string; memo: string | null }, { system = false } = {}) {
    await this.lock(tx, organizationId); // re-entrant: the same transaction may already hold it
    const e = await this.find(tx, organizationId, id);
    if (e.status !== 'posted') throw refuse(ConflictException, 'Only posted entries can be reversed. Edit or delete the draft instead.', 'not_posted');
    if (e.reversedBy) throw refuse(ConflictException, 'This entry has already been reversed.', 'already_reversed');
    if (e.reversalOf) throw refuse(ConflictException, 'A reversal can’t itself be reversed. Post a new entry instead.', 'is_reversal');
    // Only the reversal's own date must be open: reversing on a later date is how a closed month is corrected
    const date = input.date ?? iso(e.date);
    const original = label(e)!;
    const r = await tx.journalEntry.create({
      data: { organizationId, date: asDate(date), memo: input.memo ?? `Reversal of ${original}`, reference: e.reference, reversalOfId: id, createdById: actorId },
      select: { id: true },
    });
    // An exact mirror, tax lines included, even if a tax group has since been archived
    await this.writeRows(
      tx,
      organizationId,
      r.id,
      e.lines.map((l) => ({
        lineNo: l.lineNo,
        accountId: l.accountId,
        description: l.description,
        debit: Number(l.credit),
        credit: Number(l.debit),
        taxGroupId: l.taxGroupId,
        taxInclusive: l.taxInclusive,
        taxRateId: l.taxRateId,
        taxSourceLine: l.taxSourceLine,
        currency: l.currency,
        foreignDebit: Number(l.foreignCredit),
        foreignCredit: Number(l.foreignDebit),
        rate: l.rate && rateText(l.rate),
        fxSourceLine: l.fxSourceLine,
      })),
    );
    const posted = await this.postInTx(tx, organizationId, r.id, actorId, { recomputeTax: false, system });
    return { id: r.id, number: posted.number, original, date };
  }

  /**
   * Writes and posts an entry for another document (an invoice, a bill, a payment) inside the caller's
   * transaction, with the same rules as one typed by hand: tax lines, currency conversion, open period, numbering.
   */
  async postEntryInTx(tx: Tx, organizationId: string, input: { date: string; memo: string; reference: string | null; lines: LineIn[] }, actorId: string) {
    await this.lock(tx, organizationId);
    const e = await tx.journalEntry.create({ data: { organizationId, date: asDate(input.date), memo: input.memo, reference: input.reference, createdById: actorId }, select: { id: true } });
    await this.writeLines(tx, organizationId, e.id, input.date, input.lines);
    const posted = await this.postInTx(tx, organizationId, e.id, actorId);
    return { id: e.id, number: posted.number };
  }

  /** Posts an entry the system writes itself (the year-end close), inside the caller's transaction. */
  async postSystemEntry(tx: Tx, organizationId: string, input: { date: string; memo: string; lines: { accountId: string; debit: number; credit: number; description?: string | null; currency?: string | null }[] }, actorId: string) {
    await this.lock(tx, organizationId);
    const e = await tx.journalEntry.create({ data: { organizationId, date: asDate(input.date), memo: input.memo, createdById: actorId }, select: { id: true } });
    await this.writeRows(
      tx,
      organizationId,
      e.id,
      input.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, description: l.description ?? null, debit: l.debit, credit: l.credit, taxGroupId: null, taxInclusive: false, taxRateId: null, taxSourceLine: null, currency: l.currency ?? null, foreignDebit: 0, foreignCredit: 0, rate: null, fxSourceLine: null })),
    );
    const posted = await this.postInTx(tx, organizationId, e.id, actorId, { recomputeTax: false, system: true });
    return { id: e.id, number: posted.number };
  }

  // ---------- attachments ----------

  async attach(id: string, file: { fileName: string; type: AttachmentType; data: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length || bytes.length > ATTACHMENT_MAX_BYTES) throw refuse(BadRequestException, 'Attach a file under 2 MB.', 'too_large');
    if (sniffAttachmentType(bytes) !== file.type) throw refuse(BadRequestException, 'That file isn’t the type it claims to be.', 'type_mismatch');
    await this.prisma.$transaction(async (tx) => {
      await this.find(tx, organizationId, id);
      const a = await tx.journalAttachment.create({ data: { organizationId, entryId: id, fileName: file.fileName, contentType: file.type, size: bytes.length, data: bytes, uploadedById: ctx.actor.userId }, select: { id: true } });
      await this.audit.record({ action: 'org.journal.attach', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, after: { attachmentId: a.id, fileName: file.fileName, bytes: bytes.length }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }

  async attachment(organizationId: string, id: string, attachmentId: string) {
    const a = await this.prisma.journalAttachment.findFirst({ where: { id: attachmentId, entryId: id, organizationId }, select: { fileName: true, contentType: true, data: true } });
    if (!a) throw new NotFoundException('Attachment not found.');
    return a;
  }

  /** Attachments of drafts can be removed; a posted entry's documents are part of its record. */
  async detach(id: string, attachmentId: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const e = await this.find(tx, organizationId, id);
      if (e.status !== 'draft') throw refuse(ConflictException, 'Documents of a posted entry are kept with it.', 'posted');
      const { count } = await tx.journalAttachment.deleteMany({ where: { id: attachmentId, entryId: id, organizationId } });
      if (!count) throw new NotFoundException('Attachment not found.');
      await this.audit.record({ action: 'org.journal.detach', actorId: ctx.actor.userId, organizationId, entityType: 'journal', entityId: id, before: { attachmentId }, req: ctx.req }, tx);
    });
  }

  /** Whether any of these accounts has journal lines (drafts included), for the chart of accounts. */
  static async accountsHaveLines(tx: Tx, organizationId: string, accountIds: string[]) {
    return (await tx.journalLine.count({ where: { organizationId, accountId: { in: accountIds } } })) > 0;
  }

  /** Whether anything has been posted, for the base-currency lock. */
  static async anyPosted(tx: Tx | PrismaService, organizationId: string) {
    return (await tx.journalEntry.count({ where: { organizationId, status: 'posted' } })) > 0;
  }
}
