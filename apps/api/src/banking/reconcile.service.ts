import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { journalNumber } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BankingService } from './banking.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type BookLine = {
  id: string;
  entryId: string;
  number: string | null;
  date: string;
  memo: string | null;
  reference: string | null;
  description: string | null;
  amount: number;
};

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const days = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000;
const words = (s: string | null) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
const lineSelect = {
  id: true,
  debit: true,
  credit: true,
  foreignDebit: true,
  foreignCredit: true,
  description: true,
  entry: {
    select: {
      id: true,
      number: true,
      date: true,
      memo: true,
      reference: true,
      fiscalYear: { select: { name: true } },
    },
  },
} as const;

/**
 * Checking the books against the bank. The bank's lines are matched to the account's book lines (suggested by
 * amount, date and shared words), created where the books are missing them, or ignored. Reconciling to a
 * statement's date and balance needs every bank line up to then dealt with, and the books to agree once
 * what hasn't reached the bank yet is allowed for; it then locks those matches.
 */
@Injectable()
export class ReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly banking: BankingService,
  ) {}

  private async account(
    db: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const a = await db.account.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        currency: true,
      },
    });
    if (!a || a.type !== 'asset' || !['bank', 'cash'].includes(a.subtype))
      throw refuse(
        BadRequestException,
        'Choose a bank or cash account.',
        'bank_invalid',
        { field: 'bankAccountId' },
      );
    return a;
  }

  /** A book line's amount in the account's own currency: money in positive */
  private amount(
    l: {
      debit: bigint;
      credit: bigint;
      foreignDebit: bigint;
      foreignCredit: bigint;
    },
    foreign: boolean,
  ) {
    return Number(
      foreign ? l.foreignDebit - l.foreignCredit : l.debit - l.credit,
    );
  }

  private book(
    l: Prisma.JournalLineGetPayload<{ select: typeof lineSelect }>,
    foreign: boolean,
  ): BookLine {
    return {
      id: l.id,
      entryId: l.entry.id,
      number:
        l.entry.number && l.entry.fiscalYear
          ? journalNumber(l.entry.fiscalYear.name, l.entry.number)
          : null,
      date: iso(l.entry.date),
      memo: l.entry.memo,
      reference: l.entry.reference,
      description: l.description,
      amount: this.amount(l, foreign),
    };
  }

  /** Book lines that can still be matched: posted, not matched, and not part of a reversal pair (which nets to nothing) */
  private unmatchedBook(
    db: Tx | PrismaService,
    organizationId: string,
    accountId: string,
    extra: Prisma.JournalLineWhereInput = {},
  ) {
    return db.journalLine.findMany({
      where: {
        organizationId,
        accountId,
        bankMatch: null,
        entry: { status: 'posted', reversalOfId: null, reversedBy: null },
        ...extra,
      },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
      select: lineSelect,
    });
  }

  /** Where the account stands on a day: the books, what hasn't reached the bank, and so what the bank should show */
  private async standing(
    db: Tx | PrismaService,
    organizationId: string,
    account: { id: string; currency: string | null },
    date: string,
  ) {
    const foreign = !!account.currency;
    const first = await db.bankStatementLine.findFirst({
      where: { organizationId, bankAccountId: account.id },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const [sum] = await db.$queryRaw<{ balance: bigint | null }[]>`
      SELECT sum(CASE WHEN ${foreign} THEN l.foreign_debit - l.foreign_credit ELSE l.debit - l.credit END)::bigint AS balance
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${account.id}::uuid AND e.status = 'posted' AND e.date <= ${asDate(date)}::date`;
    const bookBalance = Number(sum?.balance ?? 0);
    // Before the bank's record begins, the books are taken as already through the bank
    const outstanding = first
      ? (
          await this.unmatchedBook(db, organizationId, account.id, {
            entry: {
              status: 'posted',
              reversalOfId: null,
              reversedBy: null,
              date: { gte: first.date, lte: asDate(date) },
            },
          })
        ).map((l) => this.book(l, foreign))
      : [];
    const outstandingIn = outstanding
      .filter((l) => l.amount > 0)
      .reduce((s, l) => s + l.amount, 0);
    const outstandingOut = -outstanding
      .filter((l) => l.amount < 0)
      .reduce((s, l) => s + l.amount, 0);
    return {
      bookBalance,
      outstandingIn,
      outstandingOut,
      outstanding,
      cleared: bookBalance - outstandingIn + outstandingOut,
      since: first ? iso(first.date) : null,
    };
  }

  /** Everything needed to reconcile an account up to a day */
  async workspace(organizationId: string, accountId: string, date: string) {
    const account = await this.account(this.prisma, organizationId, accountId);
    const foreign = !!account.currency;
    const [statement, ignored, book, matched, standing, last, printed] =
      await Promise.all([
        this.prisma.bankStatementLine.findMany({
          where: {
            organizationId,
            bankAccountId: account.id,
            status: 'unmatched',
          },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
          take: 500,
          select: {
            id: true,
            date: true,
            description: true,
            reference: true,
            amount: true,
            balance: true,
          },
        }),
        this.prisma.bankStatementLine.findMany({
          where: {
            organizationId,
            bankAccountId: account.id,
            status: 'ignored',
          },
          orderBy: { date: 'desc' },
          take: 100,
          select: {
            id: true,
            date: true,
            description: true,
            reference: true,
            amount: true,
          },
        }),
        this.unmatchedBook(this.prisma, organizationId, account.id),
        this.prisma.bankStatementLine.findMany({
          where: {
            organizationId,
            bankAccountId: account.id,
            status: 'matched',
            matches: { some: { reconciliationId: null } },
          },
          orderBy: { date: 'desc' },
          take: 100,
          select: {
            id: true,
            date: true,
            description: true,
            reference: true,
            amount: true,
            matches: { select: { journalLine: { select: lineSelect } } },
          },
        }),
        this.standing(this.prisma, organizationId, account, date),
        this.prisma.bankReconciliation.findFirst({
          where: { organizationId, bankAccountId: account.id },
          orderBy: { statementDate: 'desc' },
          select: {
            id: true,
            statementDate: true,
            statementBalance: true,
            createdAt: true,
          },
        }),
        this.prisma.bankStatementLine.findFirst({
          where: {
            organizationId,
            bankAccountId: account.id,
            date: { lte: asDate(date) },
            balance: { not: null },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: { balance: true, date: true },
        }),
      ]);
    const bookLines = book.map((l) => this.book(l, foreign));
    const bankLines = statement.map((s) => ({
      id: s.id,
      date: iso(s.date),
      description: s.description,
      reference: s.reference,
      amount: Number(s.amount),
      balance: s.balance === null ? null : Number(s.balance),
    }));
    // Suggestions: the same amount within ten days, closer and sharing words (or the reference) first
    const scored: {
      statementLineId: string;
      journalLineId: string;
      score: number;
    }[] = [];
    for (const s of bankLines) {
      const sw = new Set([...words(s.description), ...words(s.reference)]);
      for (const b of bookLines) {
        if (b.amount !== s.amount || days(b.date, s.date) > 10) continue;
        const bw = new Set([
          ...words(b.memo),
          ...words(b.reference),
          ...words(b.description),
        ]);
        const shared = [...sw].filter((w) => bw.has(w)).length;
        const refMatch =
          !!s.reference &&
          !!b.reference &&
          (s.reference.toLowerCase().includes(b.reference.toLowerCase()) ||
            b.reference.toLowerCase().includes(s.reference.toLowerCase()));
        scored.push({
          statementLineId: s.id,
          journalLineId: b.id,
          score:
            100 -
            5 * days(b.date, s.date) +
            Math.min(shared, 3) * 10 +
            (refMatch ? 40 : 0),
        });
      }
    }
    const usedS = new Set<string>();
    const usedB = new Set<string>();
    const suggestions = scored
      .sort((a, b) => b.score - a.score)
      .filter((x) => {
        if (usedS.has(x.statementLineId) || usedB.has(x.journalLineId))
          return false;
        usedS.add(x.statementLineId);
        usedB.add(x.journalLineId);
        return true;
      })
      .map((x) => ({
        statementLineId: x.statementLineId,
        journalLineIds: [x.journalLineId],
        confidence: x.score >= 120 ? ('high' as const) : ('medium' as const),
      }));
    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        currency: account.currency,
      },
      date,
      bankLines,
      bookLines,
      suggestions,
      matched: matched.map((m) => ({
        id: m.id,
        date: iso(m.date),
        description: m.description,
        reference: m.reference,
        amount: Number(m.amount),
        bookLines: m.matches.map((x) => this.book(x.journalLine, foreign)),
      })),
      ignored: ignored.map((i) => ({
        id: i.id,
        date: iso(i.date),
        description: i.description,
        reference: i.reference,
        amount: Number(i.amount),
      })),
      summary: {
        bookBalance: standing.bookBalance,
        outstandingIn: standing.outstandingIn,
        outstandingOut: standing.outstandingOut,
        cleared: standing.cleared,
        since: standing.since,
        unmatchedToDate: bankLines.filter((l) => l.date <= date).length,
        /** The balance the bank printed on its last line up to the day, if it prints one */
        statementBalance:
          printed?.balance === null || !printed
            ? null
            : Number(printed.balance),
      },
      lastReconciliation: last && {
        id: last.id,
        statementDate: iso(last.statementDate),
        statementBalance: Number(last.statementBalance),
        createdAt: last.createdAt,
      },
    };
  }

  private async statementLine(tx: Tx, organizationId: string, id: string) {
    const s = await tx.bankStatementLine.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        bankAccountId: true,
        date: true,
        description: true,
        reference: true,
        amount: true,
        status: true,
        matches: {
          select: { id: true, reconciliationId: true, journalLineId: true },
        },
      },
    });
    if (!s) throw new NotFoundException('Statement line not found.');
    return s;
  }

  /** Matches a bank line to one or more book lines on its account whose amounts add up to it */
  async match(
    input: { statementLineId: string; journalLineIds: string[] },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reconcile:' + organizationId}))`;
      const s = await this.statementLine(
        tx,
        organizationId,
        input.statementLineId,
      );
      if (s.status !== 'unmatched')
        throw refuse(
          ConflictException,
          'This bank line is already dealt with.',
          'line_not_unmatched',
        );
      const account = await this.account(tx, organizationId, s.bankAccountId);
      const lines = await tx.journalLine.findMany({
        where: { organizationId, id: { in: input.journalLineIds } },
        select: {
          ...lineSelect,
          accountId: true,
          bankMatch: { select: { id: true } },
          entry: {
            select: {
              ...lineSelect.entry.select,
              status: true,
              reversalOfId: true,
              reversedBy: { select: { id: true } },
            },
          },
        },
      });
      if (lines.length !== new Set(input.journalLineIds).size)
        throw refuse(
          BadRequestException,
          'A book line wasn’t found.',
          'book_line_not_found',
        );
      for (const l of lines) {
        if (l.accountId !== account.id)
          throw refuse(
            BadRequestException,
            'A book line is on another account.',
            'other_account',
          );
        if (
          l.entry.status !== 'posted' ||
          l.entry.reversalOfId ||
          l.entry.reversedBy
        )
          throw refuse(
            BadRequestException,
            'Only posted entries that stand can be matched.',
            'book_line_not_posted',
          );
        if (l.bankMatch)
          throw refuse(
            ConflictException,
            'A book line is already matched.',
            'book_line_matched',
          );
      }
      const total = lines.reduce(
        (sum, l) => sum + this.amount(l, !!account.currency),
        0,
      );
      if (total !== Number(s.amount))
        throw refuse(
          BadRequestException,
          'The book lines don’t add up to the bank line.',
          'amounts_differ',
          { bank: Number(s.amount), book: total },
        );
      await tx.bankMatch.createMany({
        data: lines.map((l) => ({
          organizationId,
          statementLineId: s.id,
          journalLineId: l.id,
          createdById: ctx.actor.userId,
        })),
      });
      await tx.bankStatementLine.update({
        where: { id: s.id },
        data: { status: 'matched' },
      });
      await this.audit.record(
        {
          action: 'org.banking.match',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_statement_line',
          entityId: s.id,
          after: {
            account: `${account.code} ${account.name}`,
            date: iso(s.date),
            amount: Number(s.amount),
            description: s.description,
            entries: lines.map((l) => l.entry.number),
          },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  async unmatch(statementLineId: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const s = await this.statementLine(tx, organizationId, statementLineId);
      if (s.status !== 'matched')
        throw refuse(
          ConflictException,
          'This bank line isn’t matched.',
          'line_not_matched',
        );
      if (s.matches.some((m) => m.reconciliationId))
        throw refuse(
          ConflictException,
          'This line is reconciled. Undo the reconciliation first.',
          'reconciled',
        );
      await tx.bankMatch.deleteMany({
        where: { organizationId, statementLineId: s.id },
      });
      await tx.bankStatementLine.update({
        where: { id: s.id },
        data: { status: 'unmatched' },
      });
      await this.audit.record(
        {
          action: 'org.banking.unmatch',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_statement_line',
          entityId: s.id,
          before: {
            date: iso(s.date),
            amount: Number(s.amount),
            description: s.description,
          },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** Sets a bank line aside (the bank's balance-forward line, a duplicate), or brings it back */
  async ignore(statementLineId: string, ignored: boolean, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const s = await this.statementLine(tx, organizationId, statementLineId);
      if (s.status === 'matched')
        throw refuse(
          ConflictException,
          'This bank line is matched. Unmatch it first.',
          'line_matched',
        );
      await tx.bankStatementLine.update({
        where: { id: s.id },
        data: { status: ignored ? 'ignored' : 'unmatched' },
      });
      await this.audit.record(
        {
          action: ignored ? 'org.banking.ignore' : 'org.banking.unignore',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_statement_line',
          entityId: s.id,
          after: {
            date: iso(s.date),
            amount: Number(s.amount),
            description: s.description,
          },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /** Records what the books are missing from a bank line (charges, interest) and matches it, in one step */
  async create(
    input: {
      statementLineId: string;
      accountId: string;
      taxGroupId: string | null;
      description: string | null;
      contactId: string | null;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const s = await this.prisma.bankStatementLine.findFirst({
      where: { organizationId, id: input.statementLineId },
      select: {
        id: true,
        bankAccountId: true,
        date: true,
        description: true,
        reference: true,
        amount: true,
        status: true,
      },
    });
    if (!s) throw new NotFoundException('Statement line not found.');
    if (s.status !== 'unmatched')
      throw refuse(
        ConflictException,
        'This bank line is already dealt with.',
        'line_not_unmatched',
      );
    const amount = Number(s.amount);
    const t = await this.banking.money(
      // The bank's figure is what moved, tax and all
      {
        kind: amount < 0 ? 'spend' : 'receive',
        bankAccountId: s.bankAccountId,
        date: iso(s.date),
        contactId: input.contactId,
        reference: s.reference,
        description: input.description ?? s.description,
        taxInclusive: !!input.taxGroupId,
        rate: null,
        lines: [
          {
            accountId: input.accountId,
            amount: Math.abs(amount),
            taxGroupId: input.taxGroupId,
            description: null,
          },
        ],
      },
      ctx,
    );
    const bankLine = await this.prisma.journalLine.findFirst({
      where: {
        organizationId,
        entryId: t.journalEntry.id,
        accountId: s.bankAccountId,
      },
      select: { id: true },
    });
    await this.match(
      { statementLineId: s.id, journalLineIds: [bankLine!.id] },
      ctx,
    );
    return t;
  }

  /** Agrees the account with a statement: every bank line to the day dealt with, and the balances equal. Locks the matches. */
  async reconcile(
    input: {
      bankAccountId: string;
      statementDate: string;
      statementBalance: number;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reconcile:' + organizationId}))`;
      const account = await this.account(
        tx,
        organizationId,
        input.bankAccountId,
      );
      const last = await tx.bankReconciliation.findFirst({
        where: { organizationId, bankAccountId: account.id },
        orderBy: { statementDate: 'desc' },
        select: { statementDate: true },
      });
      if (last && input.statementDate <= iso(last.statementDate))
        throw refuse(
          BadRequestException,
          `The account is reconciled to ${iso(last.statementDate)} already.`,
          'before_last',
          { last: iso(last.statementDate) },
        );
      const open = await tx.bankStatementLine.count({
        where: {
          organizationId,
          bankAccountId: account.id,
          status: 'unmatched',
          date: { lte: asDate(input.statementDate) },
        },
      });
      if (open)
        throw refuse(
          ConflictException,
          `${open} bank line(s) up to this day still need matching, creating or ignoring.`,
          'unmatched_lines',
          { count: open },
        );
      const st = await this.standing(
        tx,
        organizationId,
        account,
        input.statementDate,
      );
      if (st.cleared !== input.statementBalance)
        throw refuse(
          ConflictException,
          'The books don’t agree with the statement balance yet.',
          'difference',
          {
            cleared: st.cleared,
            statementBalance: input.statementBalance,
            difference: input.statementBalance - st.cleared,
          },
        );
      const r = await tx.bankReconciliation.create({
        data: {
          organizationId,
          bankAccountId: account.id,
          statementDate: asDate(input.statementDate),
          statementBalance: BigInt(input.statementBalance),
          bookBalance: BigInt(st.bookBalance),
          outstandingIn: BigInt(st.outstandingIn),
          outstandingOut: BigInt(st.outstandingOut),
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      const locked = await tx.bankMatch.updateMany({
        where: {
          organizationId,
          reconciliationId: null,
          statementLine: {
            bankAccountId: account.id,
            date: { lte: asDate(input.statementDate) },
          },
        },
        data: { reconciliationId: r.id },
      });
      await this.audit.record(
        {
          action: 'org.banking.reconcile',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_reconciliation',
          entityId: r.id,
          after: {
            account: `${account.code} ${account.name}`,
            statementDate: input.statementDate,
            statementBalance: input.statementBalance,
            bookBalance: st.bookBalance,
            outstandingIn: st.outstandingIn,
            outstandingOut: st.outstandingOut,
            matchesLocked: locked.count,
          },
          req: ctx.req,
        },
        tx,
      );
      return r.id;
    });
    return this.getReconciliation(organizationId, id);
  }

  async getReconciliation(organizationId: string, id: string) {
    const r = await this.prisma.bankReconciliation.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        bankAccountId: true,
        statementDate: true,
        statementBalance: true,
        bookBalance: true,
        outstandingIn: true,
        outstandingOut: true,
        createdAt: true,
        _count: { select: { matches: true } },
      },
    });
    if (!r) throw new NotFoundException('Reconciliation not found.');
    return {
      id: r.id,
      bankAccountId: r.bankAccountId,
      statementDate: iso(r.statementDate),
      statementBalance: Number(r.statementBalance),
      bookBalance: Number(r.bookBalance),
      outstandingIn: Number(r.outstandingIn),
      outstandingOut: Number(r.outstandingOut),
      matches: r._count.matches,
      createdAt: r.createdAt,
    };
  }

  async reconciliations(organizationId: string, bankAccountId: string) {
    const rows = await this.prisma.bankReconciliation.findMany({
      where: { organizationId, bankAccountId },
      orderBy: { statementDate: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(
      rows.map((r) => this.getReconciliation(organizationId, r.id)),
    );
  }

  /** Undoes the account's latest reconciliation, unlocking its matches */
  async undo(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.bankReconciliation.findFirst({
        where: { organizationId, id },
        select: { id: true, bankAccountId: true, statementDate: true },
      });
      if (!r) throw new NotFoundException('Reconciliation not found.');
      const later = await tx.bankReconciliation.count({
        where: {
          organizationId,
          bankAccountId: r.bankAccountId,
          statementDate: { gt: r.statementDate },
        },
      });
      if (later)
        throw refuse(
          ConflictException,
          'Only the latest reconciliation can be undone.',
          'not_latest',
        );
      await tx.bankMatch.updateMany({
        where: { organizationId, reconciliationId: r.id },
        data: { reconciliationId: null },
      });
      await tx.bankReconciliation.delete({ where: { id: r.id } });
      await this.audit.record(
        {
          action: 'org.banking.reconcile_undo',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_reconciliation',
          entityId: r.id,
          before: { statementDate: iso(r.statementDate) },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
